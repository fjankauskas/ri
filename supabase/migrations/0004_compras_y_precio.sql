-- 0004: precio en productos + pedidos de compra entre empresas conectadas.
-- Flujo: el comprador pide sobre el stock que el proveedor publicó -> el proveedor acepta (se reserva stock
-- por vencimiento, FEFO, creando pedidos de venta) o rechaza -> el proveedor despacha -> el comprador recibe.

alter table products add column price numeric(18,2) check (price is null or price >= 0);

create table purchase_requests (
  id uuid primary key default gen_random_uuid(),
  buyer_org uuid not null references organizations,
  supplier_org uuid not null references organizations,
  product_id uuid not null references products,          -- producto del catálogo del PROVEEDOR
  qty numeric(18,4) not null check (qty > 0),
  note text,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','ACCEPTED','REJECTED','CANCELLED')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz);
alter table purchase_requests enable row level security;
create policy pr_read on purchase_requests for select to authenticated using (private.is_member(buyer_org) or private.is_member(supplier_org));
revoke insert, update, delete on purchase_requests from anon, authenticated;
grant select on purchase_requests to authenticated, service_role;

-- Stock publicado por las empresas conectadas, con los ids necesarios para pedir y el precio de lista
create function public.partner_offers() returns table(partner_id uuid, partner text, product_id uuid, product text, unit text, qty numeric, price numeric)
language sql stable security definer set search_path = '' as $$
  select o.id, o.display_name, p.id, p.name, p.unit, so.qty, p.price
  from public.stock_offers so
  join public.products p on p.id = so.product_id
  join public.organizations o on o.id = so.organization_id
  where so.qty > 0 and exists (select 1 from public.business_relationships r where r.status = 'ACTIVE'
    and ((r.organization_a = so.organization_id and private.is_member(r.organization_b)) or (r.organization_b = so.organization_id and private.is_member(r.organization_a))))
  order by o.display_name, p.name; $$;

create function public.request_purchase(p_org uuid, p_supplier uuid, p_product uuid, p_qty numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare av numeric; rid uuid; begin
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
  insert into public.purchase_requests(buyer_org, supplier_org, product_id, qty, note)
    values (p_org, p_supplier, p_product, p_qty, nullif(btrim(coalesce(p_note, '')), '')) returning id into rid;
  return rid; end $$;

create function public.my_purchase_requests() returns table(id uuid, direction text, partner text, product text, unit text, qty numeric, note text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, case when private.is_member(r.supplier_org) then 'RECEIVED' else 'SENT' end, o.display_name, p.name, p.unit, r.qty, r.note, r.status, r.created_at
  from public.purchase_requests r join public.products p on p.id = r.product_id
  join public.organizations o on o.id = case when private.is_member(r.supplier_org) then r.buyer_org else r.supplier_org end
  where private.is_member(r.supplier_org) or private.is_member(r.buyer_org) order by r.created_at desc; $$;

-- El proveedor acepta: reserva stock disponible (primero lo que vence antes) y genera un pedido de venta por cada lote usado
create function public.accept_purchase_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests; need numeric; a record; take numeric; begin
  select * into r from public.purchase_requests where id = p_id for update;
  if r.id is null or r.status <> 'REQUESTED' then raise exception 'REQUEST_NOT_PENDING: el pedido ya no está pendiente'; end if;
  if not private.is_member(r.supplier_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  need := r.qty;
  for a in select ip.warehouse_id, ip.lot_id, ip.quantity - ip.reserved as av
           from public.inventory_positions ip join public.lots l on l.id = ip.lot_id
           where ip.organization_id = r.supplier_org and ip.product_id = r.product_id and ip.quantity - ip.reserved > 0
           order by l.expiration_date nulls last, l.created_at loop
    exit when need <= 0;
    take := least(a.av, need);
    perform public.create_sales_order(a.warehouse_id, r.buyer_org, r.product_id, a.lot_id, take);
    need := need - take;
  end loop;
  if need > 0 then raise exception 'INSUFFICIENT_STOCK: tu stock disponible no alcanza para este pedido (faltan %)', need; end if;
  update public.purchase_requests set status = 'ACCEPTED', resolved_at = now() where id = p_id; end $$;

create function public.reject_purchase_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests; begin
  select * into r from public.purchase_requests where id = p_id for update;
  if r.id is null or r.status <> 'REQUESTED' then raise exception 'REQUEST_NOT_PENDING: el pedido ya no está pendiente'; end if;
  if not private.is_member(r.supplier_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  update public.purchase_requests set status = 'REJECTED', resolved_at = now() where id = p_id; end $$;

create function public.cancel_purchase_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requests; begin
  select * into r from public.purchase_requests where id = p_id for update;
  if r.id is null or r.status <> 'REQUESTED' then raise exception 'REQUEST_NOT_PENDING: el pedido ya no está pendiente'; end if;
  if not private.is_member(r.buyer_org, array['OWNER','ADMIN','INVENTORY_MANAGER','PURCHASER']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  update public.purchase_requests set status = 'CANCELLED', resolved_at = now() where id = p_id; end $$;

revoke all on function public.partner_offers, public.request_purchase, public.my_purchase_requests,
  public.accept_purchase_request, public.reject_purchase_request, public.cancel_purchase_request from public, anon;
grant execute on function public.partner_offers, public.request_purchase, public.my_purchase_requests,
  public.accept_purchase_request, public.reject_purchase_request, public.cancel_purchase_request to authenticated;

notify pgrst, 'reload schema';
