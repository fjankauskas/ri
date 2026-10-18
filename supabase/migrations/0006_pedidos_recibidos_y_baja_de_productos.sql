-- 0006: pedidos que se cierran al recibir, y eliminar productos
-- Ejecutar DESPUÉS de 0005. No borra datos.

-- 1) Los pedidos quedaban en "despachado" aunque el comprador ya hubiera confirmado la recepción.
--    Ahora el envío queda vinculado a su pedido y, al recibirlo, el pedido pasa a "recibido".
alter table shipments add column sales_order_id uuid references sales_orders;

do $$ declare c text; begin
  select conname into c from pg_constraint
   where conrelid = 'public.sales_orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%CONFIRMED%';
  if c is not null then execute format('alter table public.sales_orders drop constraint %I', c); end if;
end $$;
alter table sales_orders add constraint sales_orders_status_check check (status in ('CONFIRMED','SHIPPED','RECEIVED','CANCELLED'));

create or replace function public.ship_sales_order(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders; sid uuid; begin
  select * into o from public.sales_orders where id = p_id for update;
  if o.id is null or o.status <> 'CONFIRMED' then raise exception 'ORDER_NOT_PENDING'; end if;
  if not private.is_member(o.seller_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES','WAREHOUSE']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  update public.inventory_positions set reserved = reserved - o.qty where warehouse_id = o.warehouse_id and product_id = o.product_id and lot_id = o.lot_id;
  sid := public.ship_to_org(o.warehouse_id, o.buyer_org, o.product_id, o.lot_id, o.qty);
  update public.shipments set sales_order_id = p_id where id = sid;                                          -- vincula el envío con su pedido
  update public.sales_orders set status = 'SHIPPED' where id = p_id; return sid; end $$;

create or replace function public.receive_shipment(p_ship uuid, p_to_wh uuid, p_qty numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.shipments; sp public.products; sl public.lots; pid uuid; lid uuid; tx uuid; begin
  select * into s from public.shipments where id = p_ship for update;
  if s.id is null or s.status <> 'IN_TRANSIT' then raise exception 'SHIPMENT_NOT_PENDING'; end if;
  if not private.is_member(s.to_org, array['OWNER','ADMIN','INVENTORY_MANAGER','WAREHOUSE']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > s.qty_shipped then raise exception 'INVALID_QUANTITY: debe estar entre 0 y %', s.qty_shipped; end if;
  if not exists (select 1 from public.warehouses w where w.id = p_to_wh and w.organization_id = s.to_org) then raise exception 'INVALID_WAREHOUSE'; end if;
  select * into sp from public.products where id = s.product_id;
  select * into sl from public.lots where id = s.lot_id;
  insert into public.products(organization_id, sku, name, unit) values (s.to_org, sp.sku, sp.name, sp.unit)
    on conflict (organization_id, sku) do update set name = excluded.name returning id into pid;
  insert into public.lots(product_id, lot_number, production_date, expiration_date, origin_lot_id) values (pid, sl.lot_number, sl.production_date, sl.expiration_date, s.lot_id)
    on conflict (product_id, lot_number) do update set origin_lot_id = coalesce(public.lots.origin_lot_id, excluded.origin_lot_id) returning id into lid;
  insert into public.inventory_transactions(organization_id, type, note) values (s.to_org, 'RECEIPT', 'Recepción de envío') returning id into tx;
  insert into public.inventory_positions(organization_id, warehouse_id, product_id, lot_id, quantity) values (s.to_org, p_to_wh, pid, lid, p_qty)
    on conflict (warehouse_id, product_id, lot_id) do update set quantity = public.inventory_positions.quantity + excluded.quantity;
  insert into public.inventory_events(transaction_id, organization_id, event_type, product_id, lot_id, to_warehouse_id, quantity)
    values (tx, s.to_org, 'RECEIPT', pid, lid, p_to_wh, p_qty);
  update public.shipments set status = 'RECEIVED', qty_received = p_qty, received_at = now(), to_warehouse = p_to_wh where id = p_ship;
  update public.sales_orders set status = 'RECEIVED' where id = s.sales_order_id and status = 'SHIPPED';   -- cierra el pedido asociado
  return tx; end $$;

-- Pedidos ya despachados cuyo envío ya fue recibido: se marcan como recibidos
update public.sales_orders o set status = 'RECEIVED'
 where o.status = 'SHIPPED' and exists (select 1 from public.shipments s
   where s.from_org = o.seller_org and s.to_org = o.buyer_org and s.product_id = o.product_id and s.lot_id = o.lot_id
     and s.qty_shipped = o.qty and s.status = 'RECEIVED' and s.created_at >= o.created_at);

-- 2) Eliminar producto (baja lógica: se conserva el historial). Solo si no tiene stock ni operaciones en curso.
create function public.delete_product(p_org uuid, p_product uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare stock numeric; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER']::public.org_role[]) then raise exception 'FORBIDDEN: no tenés permiso para eliminar productos'; end if;
  if not exists (select 1 from public.products where id = p_product and organization_id = p_org and is_active) then raise exception 'INVALID_PRODUCT: el producto no existe'; end if;
  select coalesce(sum(quantity), 0) into stock from public.inventory_positions where organization_id = p_org and product_id = p_product;
  if stock > 0 then raise exception 'HAS_STOCK: todavía tiene % de stock; primero eliminalo desde «Stock por lote»', stock; end if;
  if exists (select 1 from public.sales_orders where product_id = p_product and status in ('CONFIRMED','SHIPPED')) then raise exception 'HAS_ORDERS: tiene pedidos en curso; resolvelos primero'; end if;
  if exists (select 1 from public.purchase_requests where product_id = p_product and status = 'REQUESTED') then raise exception 'HAS_REQUESTS: tiene pedidos de compra pendientes; resolvelos primero'; end if;
  if exists (select 1 from public.bom_items i join public.bill_of_materials b on b.id = i.bom_id where i.component_id = p_product and b.is_active) then
    raise exception 'IN_RECIPE: se usa como insumo en una receta; editá esa receta primero'; end if;
  delete from public.stock_offers where organization_id = p_org and product_id = p_product;
  update public.bill_of_materials set is_active = false where product_id = p_product and is_active;
  update public.products set is_active = false, sku = sku || '#baja-' || substr(p_product::text, 1, 6) where id = p_product;   -- libera el SKU para reutilizarlo
end $$;

revoke all on function public.delete_product from public, anon;
grant execute on function public.delete_product to authenticated;

notify pgrst, 'reload schema';
