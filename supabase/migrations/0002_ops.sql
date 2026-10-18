-- Operaciones de producto: alta de empresa, ingreso de stock, envíos entre empresas, conexiones
alter table lots add column origin_lot_id uuid references lots;   -- enlaza el lote recibido con el lote del emisor (trazabilidad entre empresas)
alter table products add column min_stock numeric(18,4) not null default 0;
create unique index on organizations (tax_id) where tax_id is not null;

create table shipments (
  id uuid primary key default gen_random_uuid(),
  from_org uuid not null references organizations, to_org uuid not null references organizations,
  from_warehouse uuid not null references warehouses, to_warehouse uuid references warehouses,
  product_id uuid not null references products, lot_id uuid not null references lots,
  qty_shipped numeric(18,4) not null check (qty_shipped > 0), qty_received numeric(18,4),
  status text not null default 'IN_TRANSIT' check (status in ('IN_TRANSIT','RECEIVED')),
  created_at timestamptz not null default now(), received_at timestamptz);
alter table shipments enable row level security;
create policy sh_read on shipments for select to authenticated using (private.is_member(from_org) or private.is_member(to_org));
revoke insert, update, delete on shipments from anon, authenticated;

create function public.create_organization(p_name text, p_tax_id text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o uuid; begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'NAME_REQUIRED'; end if;
  insert into public.organizations(legal_name, display_name, tax_id) values (btrim(p_name), btrim(p_name), nullif(btrim(p_tax_id),'')) returning id into o;
  insert into public.memberships values (o, auth.uid(), 'OWNER');
  insert into public.warehouses(organization_id, name) values (o, 'Depósito principal');
  return o; end $$;

create function public.stock_in(p_org uuid, p_wh uuid, p_product uuid, p_lot text, p_qty numeric, p_note text default null,
  p_type public.event_type default 'RECEIPT', p_expires date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare lid uuid; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER','WAREHOUSE','PURCHASER']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  if p_type not in ('RECEIPT','ADJUSTMENT') then raise exception 'INVALID_TYPE'; end if;
  if not exists (select 1 from public.products where id = p_product and organization_id = p_org) then raise exception 'INVALID_PRODUCT'; end if;
  insert into public.lots(product_id, lot_number, expiration_date) values (p_product, btrim(p_lot), p_expires)
    on conflict (product_id, lot_number) do update set expiration_date = coalesce(excluded.expiration_date, public.lots.expiration_date) returning id into lid;
  return public.inventory_apply(p_org, p_type, jsonb_build_array(jsonb_build_object('product_id',p_product,'lot_id',lid,'to',p_wh,'qty',p_qty)), p_note);
end $$;

create function public.request_connection(p_my_org uuid, p_tax_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o uuid; r uuid; begin
  if not private.is_member(p_my_org, array['OWNER','ADMIN']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  select id into o from public.organizations where tax_id = btrim(p_tax_id);
  if o is null then raise exception 'ORG_NOT_FOUND: esa empresa todavía no usa la plataforma'; end if;
  if o = p_my_org then raise exception 'SAME_ORG'; end if;
  insert into public.business_relationships(organization_a, organization_b) values (p_my_org, o) returning id into r; return r; end $$;

create function public.accept_connection(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.business_relationships set status = 'ACTIVE'
   where id = p_id and status = 'PENDING' and private.is_member(organization_b, array['OWNER','ADMIN']::public.org_role[]);
  if not found then raise exception 'FORBIDDEN_OR_NOT_PENDING'; end if; end $$;

create function public.my_connections() returns table(id uuid, partner text, partner_id uuid, status text, incoming boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, o.display_name, o.id, r.status, private.is_member(r.organization_b)
  from public.business_relationships r
  join public.organizations o on o.id = case when private.is_member(r.organization_a) then r.organization_b else r.organization_a end
  where private.is_member(r.organization_a) or private.is_member(r.organization_b); $$;

create function public.ship_to_org(p_from_wh uuid, p_to_org uuid, p_product uuid, p_lot uuid, p_qty numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare fo uuid; sid uuid; begin
  select organization_id into fo from public.warehouses where id = p_from_wh;
  if not exists (select 1 from public.business_relationships r where r.status = 'ACTIVE'
      and ((r.organization_a = fo and r.organization_b = p_to_org) or (r.organization_a = p_to_org and r.organization_b = fo))) then
    raise exception 'NO_ACTIVE_RELATIONSHIP'; end if;
  perform public.inventory_apply(fo, 'SHIPMENT', jsonb_build_array(jsonb_build_object('product_id',p_product,'lot_id',p_lot,'from',p_from_wh,'qty',p_qty)), 'Envío a otra empresa');
  insert into public.shipments(from_org,to_org,from_warehouse,product_id,lot_id,qty_shipped) values (fo,p_to_org,p_from_wh,p_product,p_lot,p_qty) returning id into sid;
  return sid; end $$;

create function public.receive_shipment(p_ship uuid, p_to_wh uuid, p_qty numeric) returns uuid
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
  return tx; end $$;

create function public.my_shipments() returns table(id uuid, direction text, partner text, product text, unit text, lot text,
  qty_shipped numeric, qty_received numeric, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, case when private.is_member(s.from_org) then 'OUT' else 'IN' end, o.display_name, p.name, p.unit, l.lot_number,
         s.qty_shipped, s.qty_received, s.status, s.created_at
  from public.shipments s join public.products p on p.id = s.product_id join public.lots l on l.id = s.lot_id
  join public.organizations o on o.id = case when private.is_member(s.from_org) then s.to_org else s.from_org end
  where private.is_member(s.from_org) or private.is_member(s.to_org) order by s.created_at desc; $$;

revoke all on function public.create_organization, public.stock_in, public.request_connection, public.accept_connection,
  public.my_connections, public.ship_to_org, public.receive_shipment, public.my_shipments from public, anon;
grant execute on function public.create_organization, public.stock_in, public.request_connection, public.accept_connection,
  public.my_connections, public.ship_to_org, public.receive_shipment, public.my_shipments to authenticated;
