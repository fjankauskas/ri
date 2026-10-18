-- 0005: correcciones + precio por cantidad + crear depósitos
-- Ejecutar DESPUÉS de 0004. No borra datos.

-- 1) La tabla lots no tiene created_at: se ordena por vencimiento (primero el que vence antes), producción y número de lote.
--    Corrige "column l.created_at does not exist" al aceptar pedidos de compra y al producir.
create or replace function public.produce(p_org uuid, p_wh uuid, p_product uuid, p_qty numeric, p_lot text, p_expires date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b uuid; legs jsonb := '[]'; r record; a record; need numeric; take numeric; lid uuid; short text := ''; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER','WAREHOUSE']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  if coalesce(btrim(p_lot),'') = '' then raise exception 'LOT_REQUIRED: indicá el lote'; end if;
  select id into b from public.bill_of_materials where organization_id = p_org and product_id = p_product and is_active order by created_at desc limit 1;
  if b is null then raise exception 'NO_BOM: el producto no tiene receta activa'; end if;
  for r in select i.component_id, round(i.qty_per_unit * p_qty, 4) as req, cp.name, cp.unit
           from public.bom_items i join public.products cp on cp.id = i.component_id where i.bom_id = b loop
    need := r.req;
    for a in select ip.lot_id, ip.quantity - ip.reserved as av from public.inventory_positions ip join public.lots l on l.id = ip.lot_id
             where ip.warehouse_id = p_wh and ip.product_id = r.component_id and ip.quantity - ip.reserved > 0
             order by l.expiration_date nulls last, l.production_date nulls last, l.lot_number loop
      exit when need <= 0;
      take := least(a.av, need);
      legs := legs || jsonb_build_object('type','PRODUCTION_INPUT','product_id',r.component_id,'lot_id',a.lot_id,'from',p_wh,'qty',take);
      need := need - take;
    end loop;
    if need > 0 then short := short || format('%s %s de %s, ', round(need,3), r.unit, lower(r.name)); end if;
  end loop;
  if short <> '' then raise exception 'INSUFFICIENT_STOCK: no se puede producir, faltan %', rtrim(short, ', '); end if;
  insert into public.lots(product_id, lot_number, expiration_date, production_date) values (p_product, btrim(p_lot), p_expires, current_date)
    on conflict (product_id, lot_number) do update set expiration_date = coalesce(excluded.expiration_date, public.lots.expiration_date) returning id into lid;
  legs := legs || jsonb_build_object('type','PRODUCTION_OUTPUT','product_id',p_product,'lot_id',lid,'to',p_wh,'qty',p_qty);
  return public.inventory_apply(p_org, 'PRODUCTION_OUTPUT', legs, 'Producción'); end $$;

create or replace function public.accept_purchase_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests; need numeric; a record; take numeric; begin
  select * into r from public.purchase_requests where id = p_id for update;
  if r.id is null or r.status <> 'REQUESTED' then raise exception 'REQUEST_NOT_PENDING: el pedido ya no está pendiente'; end if;
  if not private.is_member(r.supplier_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  need := r.qty;
  for a in select ip.warehouse_id, ip.lot_id, ip.quantity - ip.reserved as av
           from public.inventory_positions ip join public.lots l on l.id = ip.lot_id
           where ip.organization_id = r.supplier_org and ip.product_id = r.product_id and ip.quantity - ip.reserved > 0
           order by l.expiration_date nulls last, l.production_date nulls last, l.lot_number loop
    exit when need <= 0;
    take := least(a.av, need);
    perform public.create_sales_order(a.warehouse_id, r.buyer_org, r.product_id, a.lot_id, take);
    need := need - take;
  end loop;
  if need > 0 then raise exception 'INSUFFICIENT_STOCK: tu stock disponible no alcanza para este pedido (faltan %)', need; end if;
  update public.purchase_requests set status = 'ACCEPTED', resolved_at = now() where id = p_id; end $$;

-- 2) Precio por cantidad: "$price cada price_per unidades" (ej. $200.000 cada 1.000 kg)
alter table products add column price_per numeric(18,4) not null default 1 check (price_per > 0);
alter table purchase_requests add column unit_price numeric(18,2), add column price_per numeric(18,4), add column total numeric(18,2);

create or replace function public.request_purchase(p_org uuid, p_supplier uuid, p_product uuid, p_qty numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare av numeric; rid uuid; v_price numeric; v_per numeric; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER','PURCHASER']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID_QUANTITY: la cantidad debe ser mayor que cero'; end if;
  if p_org = p_supplier then raise exception 'INVALID_SUPPLIER: no podés hacerte un pedido a vos mismo'; end if;
  if not exists (select 1 from public.business_relationships r where r.status = 'ACTIVE'
      and ((r.organization_a = p_org and r.organization_b = p_supplier) or (r.organization_a = p_supplier and r.organization_b = p_org))) then
    raise exception 'NO_ACTIVE_RELATIONSHIP: no tenés una conexión activa con esa empresa'; end if;
  select so.qty into av from public.stock_offers so join public.products p on p.id = so.product_id
    where so.organization_id = p_supplier and so.product_id = p_product and p.organization_id = p_supplier;
  if av is null or av <= 0 then raise exception 'NOT_OFFERED: el proveedor no tiene ese producto publicado'; end if;
  if p_qty > av then raise exception 'INVALID_QUANTITY: el proveedor publicó solo % disponibles', av; end if;
  select p.price, p.price_per into v_price, v_per from public.products p where p.id = p_product;
  insert into public.purchase_requests(buyer_org, supplier_org, product_id, qty, note, unit_price, price_per, total)
    values (p_org, p_supplier, p_product, p_qty, nullif(btrim(coalesce(p_note, '')), ''), v_price, v_per,
            case when v_price is null then null else round(p_qty / v_per * v_price, 2) end) returning id into rid;
  return rid; end $$;

drop function public.partner_offers();
create function public.partner_offers() returns table(partner_id uuid, partner text, product_id uuid, product text, unit text, qty numeric, price numeric, price_per numeric)
language sql stable security definer set search_path = '' as $$
  select o.id, o.display_name, p.id, p.name, p.unit, so.qty, p.price, p.price_per
  from public.stock_offers so
  join public.products p on p.id = so.product_id
  join public.organizations o on o.id = so.organization_id
  where so.qty > 0 and exists (select 1 from public.business_relationships r where r.status = 'ACTIVE'
    and ((r.organization_a = so.organization_id and private.is_member(r.organization_b)) or (r.organization_b = so.organization_id and private.is_member(r.organization_a))))
  order by o.display_name, p.name; $$;

drop function public.my_purchase_requests();
create function public.my_purchase_requests() returns table(id uuid, direction text, partner text, product text, unit text, qty numeric, note text, status text, created_at timestamptz, unit_price numeric, price_per numeric, total numeric)
language sql stable security definer set search_path = '' as $$
  select r.id, case when private.is_member(r.supplier_org) then 'RECEIVED' else 'SENT' end, o.display_name, p.name, p.unit, r.qty, r.note, r.status, r.created_at, r.unit_price, r.price_per, r.total
  from public.purchase_requests r join public.products p on p.id = r.product_id
  join public.organizations o on o.id = case when private.is_member(r.supplier_org) then r.buyer_org else r.supplier_org end
  where private.is_member(r.supplier_org) or private.is_member(r.buyer_org) order by r.created_at desc; $$;

drop function public.my_orders();
create function public.my_orders() returns table(id uuid, direction text, partner text, product text, unit text, lot text, qty numeric, status text, created_at timestamptz, price numeric, price_per numeric, total numeric)
language sql stable security definer set search_path = '' as $$
  select s.id, case when private.is_member(s.seller_org) then 'OUT' else 'IN' end, o.display_name, p.name, p.unit, l.lot_number, s.qty, s.status, s.created_at,
         p.price, p.price_per, case when p.price is null then null else round(s.qty / p.price_per * p.price, 2) end
  from public.sales_orders s join public.products p on p.id = s.product_id join public.lots l on l.id = s.lot_id
  join public.organizations o on o.id = case when private.is_member(s.seller_org) then s.buyer_org else s.seller_org end
  where private.is_member(s.seller_org) or private.is_member(s.buyer_org) order by s.created_at desc; $$;

-- 3) Publicar stock: 0 retira la publicación (antes dejaba una fila con 0) y se valida que el producto sea tuyo
create or replace function public.set_offer(p_org uuid, p_product uuid, p_qty numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare av numeric; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.products where id = p_product and organization_id = p_org) then raise exception 'INVALID_PRODUCT'; end if;
  select coalesce(sum(quantity - reserved), 0) into av from public.inventory_positions where organization_id = p_org and product_id = p_product;
  if p_qty is null or p_qty < 0 or p_qty > av then raise exception 'INVALID_QUANTITY: solo podés publicar hasta el stock disponible (%)', av; end if;
  if p_qty = 0 then delete from public.stock_offers where organization_id = p_org and product_id = p_product; return; end if;
  insert into public.stock_offers values (p_org, p_product, p_qty) on conflict (organization_id, product_id) do update set qty = excluded.qty; end $$;

-- 4) Crear depósitos: la tabla warehouses no tenía política de escritura, por eso se bloqueaba
create function public.create_warehouse(p_org uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare w uuid; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER']::public.org_role[]) then raise exception 'FORBIDDEN: no tenés permiso para crear depósitos'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'NAME_REQUIRED: indicá el nombre del depósito'; end if;
  insert into public.warehouses(organization_id, name) values (p_org, btrim(p_name)) returning id into w; return w; end $$;

revoke all on function public.partner_offers, public.my_purchase_requests, public.my_orders, public.create_warehouse from public, anon;
grant execute on function public.partner_offers, public.my_purchase_requests, public.my_orders, public.create_warehouse to authenticated;

notify pgrst, 'reload schema';
