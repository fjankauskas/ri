-- Red de Inventario · esquema base para Supabase (PostgreSQL)
-- Regla de oro: el stock solo cambia con public.inventory_apply(); nadie escribe tablas de inventario directo.

create extension if not exists pgcrypto;
create schema if not exists private;

create type org_role as enum ('OWNER','ADMIN','INVENTORY_MANAGER','PURCHASER','SALES','WAREHOUSE','VIEWER');
create type event_type as enum ('RECEIPT','SHIPMENT','TRANSFER','SALE','PRODUCTION_INPUT','PRODUCTION_OUTPUT','ADJUSTMENT');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null, display_name text not null, tax_id text,
  country_code char(2) not null default 'AR', created_at timestamptz not null default now());

create table memberships (
  organization_id uuid not null references organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role org_role not null, primary key (organization_id, user_id));
create index on memberships (user_id);

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  name text not null, address text, is_active boolean not null default true);

create table products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  sku text not null, name text not null, unit text not null, gtin text,
  is_active boolean not null default true, unique (organization_id, sku));

create table lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products on delete restrict,
  lot_number text not null, production_date date, expiration_date date,
  unique (product_id, lot_number));

create table inventory_positions (            -- proyección rápida; la verdad son los eventos
  organization_id uuid not null references organizations,
  warehouse_id uuid not null references warehouses,
  product_id uuid not null references products,
  lot_id uuid not null references lots,
  quantity numeric(18,4) not null default 0 check (quantity >= 0),   -- stock negativo = OFF
  reserved numeric(18,4) not null default 0 check (reserved >= 0 and reserved <= quantity),
  primary key (warehouse_id, product_id, lot_id));
create index on inventory_positions (organization_id);

create table inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations,
  type event_type not null, note text,
  created_by uuid references auth.users default auth.uid(), created_at timestamptz not null default now());

create table inventory_events (               -- inmutable: se corrige con un evento nuevo
  id bigint generated always as identity primary key,
  transaction_id uuid not null references inventory_transactions,
  organization_id uuid not null references organizations,
  event_type event_type not null,
  product_id uuid not null references products, lot_id uuid not null references lots,
  from_warehouse_id uuid references warehouses, to_warehouse_id uuid references warehouses,
  quantity numeric(18,4) not null check (quantity > 0),
  occurred_at timestamptz not null default now(),
  check (from_warehouse_id is not null or to_warehouse_id is not null));
create index on inventory_events (organization_id);
create index on inventory_events (product_id, lot_id);

create table business_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_a uuid not null references organizations,
  organization_b uuid not null references organizations,
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','BLOCKED','REJECTED')),
  can_view_stock boolean not null default false, can_view_lots boolean not null default false,
  check (organization_a <> organization_b), unique (organization_a, organization_b));

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations, user_id uuid default auth.uid(),
  action text not null, entity_type text not null, entity_id uuid, metadata jsonb,
  created_at timestamptz not null default now());

-- ---------- Seguridad ----------
create function private.is_member(org uuid, roles org_role[] default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
    where m.organization_id = org and m.user_id = auth.uid() and (roles is null or m.role = any(roles)));
$$;

do $$ declare t text; begin
  foreach t in array array['organizations','memberships','warehouses','products','lots','inventory_positions',
    'inventory_transactions','inventory_events','business_relationships','audit_logs'] loop
    execute format('alter table %I enable row level security', t);
  end loop; end $$;

create policy org_read on organizations for select to authenticated using (private.is_member(id));
create policy mem_read on memberships for select to authenticated using (private.is_member(organization_id));
create policy wh_read on warehouses for select to authenticated using (private.is_member(organization_id));
create policy prod_read on products for select to authenticated using (private.is_member(organization_id));
create policy prod_write on products for all to authenticated
  using (private.is_member(organization_id, array['OWNER','ADMIN','INVENTORY_MANAGER']::org_role[]))
  with check (private.is_member(organization_id, array['OWNER','ADMIN','INVENTORY_MANAGER']::org_role[]));
create policy lot_read on lots for select to authenticated
  using (exists (select 1 from products p where p.id = product_id and private.is_member(p.organization_id)));
create policy pos_read on inventory_positions for select to authenticated using (private.is_member(organization_id));
create policy tx_read on inventory_transactions for select to authenticated using (private.is_member(organization_id));
create policy ev_read on inventory_events for select to authenticated using (private.is_member(organization_id));
create policy rel_read on business_relationships for select to authenticated
  using (private.is_member(organization_a) or private.is_member(organization_b));
create policy audit_read on audit_logs for select to authenticated
  using (private.is_member(organization_id, array['OWNER','ADMIN']::org_role[]));

-- Inventario: lectura sí, escritura directa NO (solo vía inventory_apply)
revoke insert, update, delete on inventory_positions, inventory_transactions, inventory_events, audit_logs from anon, authenticated;

-- ---------- Operación transaccional: todo o nada ----------
-- p_legs: [{"product_id":..,"lot_id":..,"from":wh|null,"to":wh|null,"qty":n,"type":"RECEIPT"}]
create function public.inventory_apply(p_org uuid, p_type event_type, p_legs jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare tx uuid; leg jsonb; qty numeric; src uuid; dst uuid; avail numeric;
begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER','WAREHOUSE','PURCHASER','SALES']::public.org_role[]) then
    raise exception 'FORBIDDEN'; end if;
  if p_type = 'ADJUSTMENT' and coalesce(btrim(p_note),'') = '' then raise exception 'ADJUSTMENT_REQUIRES_REASON'; end if;
  insert into public.inventory_transactions(organization_id,type,note) values (p_org,p_type,p_note) returning id into tx;
  for leg in select * from jsonb_array_elements(p_legs) loop
    qty := (leg->>'qty')::numeric; src := nullif(leg->>'from','')::uuid; dst := nullif(leg->>'to','')::uuid;
    if qty is null or qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;
    if (src is not null and not exists (select 1 from public.warehouses w where w.id = src and w.organization_id = p_org))
       or (dst is not null and not exists (select 1 from public.warehouses w where w.id = dst and w.organization_id = p_org)) then
      raise exception 'INVALID_WAREHOUSE'; end if;
    if not exists (select 1 from public.products p where p.id = (leg->>'product_id')::uuid and p.organization_id = p_org) then
      raise exception 'INVALID_PRODUCT'; end if;
    if src is not null then
      select quantity - reserved into avail from public.inventory_positions
        where warehouse_id = src and product_id = (leg->>'product_id')::uuid and lot_id = (leg->>'lot_id')::uuid for update;
      if coalesce(avail,0) < qty then raise exception 'INSUFFICIENT_STOCK: disponible %, requerido %', coalesce(avail,0), qty; end if;
      update public.inventory_positions set quantity = quantity - qty
        where warehouse_id = src and product_id = (leg->>'product_id')::uuid and lot_id = (leg->>'lot_id')::uuid;
    end if;
    if dst is not null then
      insert into public.inventory_positions(organization_id,warehouse_id,product_id,lot_id,quantity)
        select w.organization_id, dst, (leg->>'product_id')::uuid, (leg->>'lot_id')::uuid, qty
        from public.warehouses w where w.id = dst
      on conflict (warehouse_id, product_id, lot_id) do update set quantity = public.inventory_positions.quantity + excluded.quantity;
    end if;
    insert into public.inventory_events(transaction_id,organization_id,event_type,product_id,lot_id,from_warehouse_id,to_warehouse_id,quantity)
      values (tx,p_org,coalesce((leg->>'type')::public.event_type,p_type),(leg->>'product_id')::uuid,(leg->>'lot_id')::uuid,src,dst,qty);
  end loop;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,metadata)
    values (p_org,'INVENTORY_'||p_type,'inventory_transaction',tx,jsonb_build_object('note',p_note,'legs',jsonb_array_length(p_legs)));
  return tx;                                  -- cualquier excepción revierte la transacción completa
end $$;
revoke all on function public.inventory_apply from public, anon;
grant execute on function public.inventory_apply to authenticated;

-- Verificación de consistencia (posición vs. suma de eventos); debe devolver 0 filas
create view public.inventory_drift with (security_invoker = true) as
select p.warehouse_id, p.product_id, p.lot_id, p.quantity as projected,
       coalesce(sum(case when e.to_warehouse_id = p.warehouse_id then e.quantity end),0)
     - coalesce(sum(case when e.from_warehouse_id = p.warehouse_id then e.quantity end),0) as from_events
from public.inventory_positions p
left join public.inventory_events e on e.product_id = p.product_id and e.lot_id = p.lot_id
  and (e.to_warehouse_id = p.warehouse_id or e.from_warehouse_id = p.warehouse_id)
group by p.warehouse_id, p.product_id, p.lot_id, p.quantity
having p.quantity <> coalesce(sum(case when e.to_warehouse_id = p.warehouse_id then e.quantity end),0)
                   - coalesce(sum(case when e.from_warehouse_id = p.warehouse_id then e.quantity end),0);
