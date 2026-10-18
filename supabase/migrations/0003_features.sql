-- Producción, pedidos con reserva, trazabilidad, alertas, stock publicable, importador, invitaciones
create table bill_of_materials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  product_id uuid not null references products, is_active boolean not null default true, created_at timestamptz not null default now());
create table bom_items (
  bom_id uuid not null references bill_of_materials on delete cascade, component_id uuid not null references products,
  qty_per_unit numeric(18,6) not null check (qty_per_unit > 0), primary key (bom_id, component_id));
create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  seller_org uuid not null references organizations, buyer_org uuid not null references organizations,
  warehouse_id uuid not null references warehouses, product_id uuid not null references products, lot_id uuid not null references lots,
  qty numeric(18,4) not null check (qty > 0),
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','SHIPPED','CANCELLED')), created_at timestamptz not null default now());
create table stock_offers (
  organization_id uuid not null references organizations, product_id uuid not null references products,
  qty numeric(18,4) not null check (qty >= 0), primary key (organization_id, product_id));
create table invitations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations, email text not null,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  status text not null default 'PENDING' check (status in ('PENDING','ACCEPTED')), created_at timestamptz not null default now());

alter table bill_of_materials enable row level security; alter table bom_items enable row level security;
alter table sales_orders enable row level security; alter table stock_offers enable row level security; alter table invitations enable row level security;
create policy bom_read on bill_of_materials for select to authenticated using (private.is_member(organization_id));
create policy bomi_read on bom_items for select to authenticated
  using (exists (select 1 from bill_of_materials b where b.id = bom_id and private.is_member(b.organization_id)));
create policy so_read on sales_orders for select to authenticated using (private.is_member(seller_org) or private.is_member(buyer_org));
create policy offer_read on stock_offers for select to authenticated using (private.is_member(organization_id));
revoke insert, update, delete on bill_of_materials, bom_items, sales_orders, stock_offers, invitations from anon, authenticated;

create function public.save_bom(p_org uuid, p_product uuid, p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare b uuid; it jsonb; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.products where id = p_product and organization_id = p_org) then raise exception 'INVALID_PRODUCT'; end if;
  update public.bill_of_materials set is_active = false where organization_id = p_org and product_id = p_product;
  insert into public.bill_of_materials(organization_id, product_id) values (p_org, p_product) returning id into b;
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from public.products where id = (it->>'component')::uuid and organization_id = p_org) then raise exception 'INVALID_PRODUCT'; end if;
    if (it->>'component')::uuid = p_product then raise exception 'INVALID_RECIPE: un producto no puede ser su propio insumo'; end if;
    insert into public.bom_items values (b, (it->>'component')::uuid, (it->>'qty')::numeric);
  end loop;
  return b; end $$;

-- Producción atómica: consume insumos (vence primero, sale primero) y genera el lote nuevo en una sola transacción
create function public.produce(p_org uuid, p_wh uuid, p_product uuid, p_qty numeric, p_lot text, p_expires date default null) returns uuid
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
             order by l.expiration_date nulls last, l.created_at loop
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

-- Trazabilidad bidireccional entre empresas: producción (insumo → producto) y envíos (lote emisor → lote receptor)
create function public.trace_lot(p_lot uuid) returns table(id bigint, event_type public.event_type, org text, product text, unit text,
  lot text, from_wh text, to_wh text, qty numeric, mine boolean, occurred_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with recursive edges(src, dst) as (
    select i.lot_id, o.lot_id from public.inventory_events i join public.inventory_events o on o.transaction_id = i.transaction_id
      where i.event_type = 'PRODUCTION_INPUT' and o.event_type = 'PRODUCTION_OUTPUT'
    union select origin_lot_id, l.id from public.lots l where origin_lot_id is not null),
  up(lot) as (select p_lot union select e.src from edges e join up on e.dst = up.lot),
  down(lot) as (select p_lot union select e.dst from edges e join down on e.src = down.lot),
  chain as (select lot from up union select lot from down),
  ev as (select x.*, private.is_member(x.organization_id) as m from public.inventory_events x where x.lot_id in (select lot from chain))
  select ev.id, ev.event_type, o.display_name, p.name, p.unit, l.lot_number,
         case when ev.m then fw.name end, case when ev.m then tw.name end, case when ev.m then ev.quantity end, ev.m, ev.occurred_at
  from ev join public.organizations o on o.id = ev.organization_id join public.products p on p.id = ev.product_id join public.lots l on l.id = ev.lot_id
  left join public.warehouses fw on fw.id = ev.from_warehouse_id left join public.warehouses tw on tw.id = ev.to_warehouse_id
  where exists (select 1 from ev e2 where e2.m) order by ev.id; $$;

create function public.create_sales_order(p_wh uuid, p_buyer uuid, p_product uuid, p_lot uuid, p_qty numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare fo uuid; oid uuid; begin
  select organization_id into fo from public.warehouses where id = p_wh;
  if not private.is_member(fo, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  if not exists (select 1 from public.business_relationships r where r.status = 'ACTIVE'
      and ((r.organization_a = fo and r.organization_b = p_buyer) or (r.organization_a = p_buyer and r.organization_b = fo))) then raise exception 'NO_ACTIVE_RELATIONSHIP'; end if;
  update public.inventory_positions set reserved = reserved + p_qty
    where warehouse_id = p_wh and product_id = p_product and lot_id = p_lot and quantity - reserved >= p_qty;
  if not found then raise exception 'INSUFFICIENT_STOCK: no hay stock disponible suficiente para reservar'; end if;
  insert into public.sales_orders(seller_org, buyer_org, warehouse_id, product_id, lot_id, qty) values (fo, p_buyer, p_wh, p_product, p_lot, p_qty) returning id into oid;
  return oid; end $$;

create function public.ship_sales_order(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders; sid uuid; begin
  select * into o from public.sales_orders where id = p_id for update;
  if o.id is null or o.status <> 'CONFIRMED' then raise exception 'ORDER_NOT_PENDING'; end if;
  if not private.is_member(o.seller_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES','WAREHOUSE']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  update public.inventory_positions set reserved = reserved - o.qty where warehouse_id = o.warehouse_id and product_id = o.product_id and lot_id = o.lot_id;
  sid := public.ship_to_org(o.warehouse_id, o.buyer_org, o.product_id, o.lot_id, o.qty);
  update public.sales_orders set status = 'SHIPPED' where id = p_id; return sid; end $$;

create function public.cancel_sales_order(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.sales_orders; begin
  select * into o from public.sales_orders where id = p_id for update;
  if o.id is null or o.status <> 'CONFIRMED' then raise exception 'ORDER_NOT_PENDING'; end if;
  if not private.is_member(o.seller_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  update public.inventory_positions set reserved = greatest(reserved - o.qty, 0) where warehouse_id = o.warehouse_id and product_id = o.product_id and lot_id = o.lot_id;
  update public.sales_orders set status = 'CANCELLED' where id = p_id; end $$;

create function public.my_orders() returns table(id uuid, direction text, partner text, product text, unit text, lot text, qty numeric, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, case when private.is_member(s.seller_org) then 'OUT' else 'IN' end, o.display_name, p.name, p.unit, l.lot_number, s.qty, s.status, s.created_at
  from public.sales_orders s join public.products p on p.id = s.product_id join public.lots l on l.id = s.lot_id
  join public.organizations o on o.id = case when private.is_member(s.seller_org) then s.buyer_org else s.seller_org end
  where private.is_member(s.seller_org) or private.is_member(s.buyer_org) order by s.created_at desc; $$;

create function public.supplier_scorecard() returns table(partner text, shipments bigint, qty_shipped numeric, qty_received numeric, diff_pct numeric, pending bigint)
language sql stable security definer set search_path = '' as $$
  select o.display_name, count(*), coalesce(sum(s.qty_shipped) filter (where s.status = 'RECEIVED'), 0), coalesce(sum(s.qty_received), 0),
         round(100 * (1 - sum(s.qty_received) / nullif(sum(s.qty_shipped) filter (where s.status = 'RECEIVED'), 0)), 2),
         count(*) filter (where s.status = 'IN_TRANSIT')
  from public.shipments s join public.organizations o on o.id = s.from_org where private.is_member(s.to_org) group by o.display_name order by 5 desc nulls last; $$;

create function public.my_alerts() returns table(kind text, label text, detail text)
language sql stable security definer set search_path = '' as $$
  select 'LOW_STOCK', p.name, format('%s %s en stock, mínimo %s', coalesce(sum(ip.quantity),0), p.unit, p.min_stock)
  from public.products p left join public.inventory_positions ip on ip.product_id = p.id
  where private.is_member(p.organization_id) and p.is_active and p.min_stock > 0 group by p.id having coalesce(sum(ip.quantity),0) < p.min_stock
  union all
  select 'EXPIRING', p.name || ' · lote ' || l.lot_number, 'vence el ' || to_char(l.expiration_date, 'DD/MM/YYYY')
  from public.inventory_positions ip join public.lots l on l.id = ip.lot_id join public.products p on p.id = ip.product_id
  where private.is_member(ip.organization_id) and ip.quantity > 0 and l.expiration_date <= current_date + 30; $$;

create function public.set_offer(p_org uuid, p_product uuid, p_qty numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare av numeric; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  select coalesce(sum(quantity - reserved), 0) into av from public.inventory_positions where organization_id = p_org and product_id = p_product;
  if p_qty < 0 or p_qty > av then raise exception 'INVALID_QUANTITY: solo podés publicar hasta el stock disponible (%)', av; end if;
  insert into public.stock_offers values (p_org, p_product, p_qty) on conflict (organization_id, product_id) do update set qty = excluded.qty; end $$;

create function public.partner_stock() returns table(partner text, product text, unit text, qty numeric)
language sql stable security definer set search_path = '' as $$
  select o.display_name, p.name, p.unit, so.qty from public.stock_offers so
  join public.products p on p.id = so.product_id join public.organizations o on o.id = so.organization_id
  where so.qty > 0 and exists (select 1 from public.business_relationships r where r.status = 'ACTIVE'
    and ((r.organization_a = so.organization_id and private.is_member(r.organization_b)) or (r.organization_b = so.organization_id and private.is_member(r.organization_a)))); $$;

create function public.import_stock(p_org uuid, p_wh uuid, p_rows jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare legs jsonb := '[]'; r jsonb; pid uuid; lid uuid; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER','WAREHOUSE','PURCHASER']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into pid from public.products where organization_id = p_org and lower(sku) = lower(r->>'sku');
    if pid is null then raise exception 'UNKNOWN_SKU: el SKU % no existe en tu catálogo', r->>'sku'; end if;
    insert into public.lots(product_id, lot_number, expiration_date) values (pid, btrim(r->>'lot'), nullif(r->>'expires','')::date)
      on conflict (product_id, lot_number) do update set expiration_date = coalesce(excluded.expiration_date, public.lots.expiration_date) returning id into lid;
    legs := legs || jsonb_build_object('product_id', pid, 'lot_id', lid, 'to', p_wh, 'qty', (r->>'qty')::numeric);
  end loop;
  return public.inventory_apply(p_org, 'RECEIPT', legs, 'Importación CSV'); end $$;

create function public.create_invitation(p_org uuid, p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare t text; begin
  if not private.is_member(p_org, array['OWNER','ADMIN']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  if position('@' in coalesce(p_email,'')) = 0 then raise exception 'INVALID_EMAIL: email inválido'; end if;
  insert into public.invitations(organization_id, email) values (p_org, lower(btrim(p_email))) returning token into t; return t; end $$;

create function public.redeem_invitation(p_token text, p_my_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invitations; begin
  if not private.is_member(p_my_org, array['OWNER','ADMIN']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  select * into i from public.invitations where token = p_token and status = 'PENDING' for update;
  if i.id is null then return; end if;
  insert into public.business_relationships(organization_a, organization_b, status) values (i.organization_id, p_my_org, 'ACTIVE') on conflict do nothing;
  update public.invitations set status = 'ACCEPTED' where id = i.id; end $$;

revoke all on function public.save_bom, public.produce, public.trace_lot, public.create_sales_order, public.ship_sales_order, public.cancel_sales_order,
  public.my_orders, public.supplier_scorecard, public.my_alerts, public.set_offer, public.partner_stock, public.import_stock,
  public.create_invitation, public.redeem_invitation from public, anon;
grant execute on function public.save_bom, public.produce, public.trace_lot, public.create_sales_order, public.ship_sales_order, public.cancel_sales_order,
  public.my_orders, public.supplier_scorecard, public.my_alerts, public.set_offer, public.partner_stock, public.import_stock,
  public.create_invitation, public.redeem_invitation to authenticated;
