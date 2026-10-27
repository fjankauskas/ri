-- 0008: GS1 — GTIN con dígito de control, presentaciones (caja/pallet), datos maestros, GLN, SSCC y resolvedor público (Digital Link).
-- Ejecutar DESPUÉS de 0007. No borra datos.

-- Dígito de control GS1 (módulo 10): la misma regla que usa la aplicación.
create function public.gs1_valid(code text) returns boolean
language sql immutable as $$
  select case when code ~ '^[0-9]{2,}$' then
    (10 - coalesce((select sum(substr(reverse(left(code, length(code) - 1)), i, 1)::int * case when i % 2 = 1 then 3 else 1 end) from generate_series(1, length(code) - 1) i), 0) % 10) % 10 = right(code, 1)::int
  else false end $$;

-- ---------- Configuración por empresa ----------
create table gs1_settings (
  organization_id uuid primary key references organizations on delete cascade,
  company_prefix text check (company_prefix ~ '^[0-9]{6,12}$'),        -- prefijo de empresa GS1 (lo asigna GS1 Argentina)
  gln text check (gln ~ '^[0-9]{13}$' and public.gs1_valid(gln)),       -- GLN de la empresa (entidad legal)
  public_enabled boolean not null default false,                         -- páginas públicas de producto (resolvedor GS1 Digital Link)
  updated_at timestamptz not null default now());
create table gs1_counters (                                              -- numeración correlativa propia (GTIN, GLN, SSCC, códigos internos)
  organization_id uuid not null references organizations on delete cascade,
  kind text not null check (kind in ('GTIN', 'GLN', 'SSCC', 'INTERNAL')),
  next_value bigint not null default 1, primary key (organization_id, kind));

-- ---------- GTIN de cada producto y presentaciones ----------
-- products.gtin queda como GTIN de la unidad de consumo; las presentaciones superiores (GTIN-14) van acá.
create table product_gtins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  product_id uuid not null references products on delete cascade,
  gtin varchar(14) not null check (gtin ~ '^([0-9]{8}|[0-9]{12,14})$' and public.gs1_valid(gtin)),
  level text not null check (level in ('INNER', 'CASE', 'PALLET')),
  units_per_pack numeric(18,4) not null default 1 check (units_per_pack > 0),
  description text, created_at timestamptz not null default now());
create unique index product_gtins_org_gtin on product_gtins (organization_id, lpad(gtin, 14, '0'));
create index product_gtins_product on product_gtins (product_id);

alter table products add constraint products_gtin_valid check (gtin is null or (gtin ~ '^([0-9]{8}|[0-9]{12,14})$' and public.gs1_valid(gtin))) not valid;
do $$ begin
  create unique index products_org_gtin_unique on public.products (organization_id, lpad(gtin, 14, '0')) where gtin is not null and is_active;
exception when unique_violation then
  raise notice 'Hay productos con el mismo GTIN dentro de una empresa: corregilos y creá después el índice products_org_gtin_unique (ver GS1-GUIA.md).';
end $$;

-- Un mismo GTIN no puede ser a la vez unidad de un producto y presentación de otro (dentro de la empresa).
create function public.gs1_gtin_conflict() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'products' then
    if new.gtin is not null and new.is_active and exists (select 1 from public.product_gtins g where g.organization_id = new.organization_id and lpad(g.gtin, 14, '0') = lpad(new.gtin, 14, '0')) then
      raise exception 'GTIN_TAKEN: el GTIN % ya se usa como presentación de otro producto', new.gtin; end if;
  elsif exists (select 1 from public.products p where p.organization_id = new.organization_id and p.is_active and p.gtin is not null and lpad(p.gtin, 14, '0') = lpad(new.gtin, 14, '0')) then
    raise exception 'GTIN_TAKEN: el GTIN % ya es la unidad de consumo de un producto', new.gtin; end if;
  return new; end $$;
create trigger products_gtin_conflict before insert or update of gtin on products for each row execute function public.gs1_gtin_conflict();
create trigger product_gtins_conflict before insert or update of gtin on product_gtins for each row execute function public.gs1_gtin_conflict();

-- ---------- Datos maestros (atributos GS1) ----------
create table product_gs1 (
  product_id uuid primary key references products on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  brand text, gpc_brick text check (gpc_brick ~ '^[0-9]{8}$'),
  net_content numeric(18,4), net_content_uom text,
  gross_weight numeric(18,4), net_weight numeric(18,4), weight_uom text default 'KGM',
  height numeric(18,4), width numeric(18,4), depth numeric(18,4), dimension_uom text default 'CMT',
  origin_country text check (origin_country ~ '^[A-Z]{2}$'), target_market text default '032',
  shelf_life_days int check (shelf_life_days is null or shelf_life_days >= 0),
  storage_min_c numeric(5,1), storage_max_c numeric(5,1),
  product_url text, image_url text, description_long text,
  updated_at timestamptz not null default now());

-- ---------- GLN de depósitos y SSCC de envíos ----------
alter table warehouses add column gln varchar(13);
alter table warehouses add constraint warehouses_gln_valid check (gln is null or (gln ~ '^[0-9]{13}$' and public.gs1_valid(gln))) not valid;
alter table shipments add column sscc varchar(18);
alter table shipments add constraint shipments_sscc_valid check (sscc is null or (sscc ~ '^[0-9]{18}$' and public.gs1_valid(sscc))) not valid;
create unique index shipments_sscc_unique on shipments (sscc) where sscc is not null;   -- el SSCC es único en el mundo

-- ---------- Permisos ----------
alter table gs1_settings enable row level security;
alter table gs1_counters enable row level security;
alter table product_gtins enable row level security;
alter table product_gs1 enable row level security;
create policy gs1_settings_read on gs1_settings for select to authenticated using (private.is_member(organization_id));
create policy gs1_settings_write on gs1_settings for all to authenticated
  using (private.is_member(organization_id, array['OWNER','ADMIN']::org_role[])) with check (private.is_member(organization_id, array['OWNER','ADMIN']::org_role[]));
create policy product_gtins_read on product_gtins for select to authenticated using (private.is_member(organization_id));
create policy product_gtins_write on product_gtins for all to authenticated
  using (private.is_member(organization_id, array['OWNER','ADMIN','INVENTORY_MANAGER']::org_role[])) with check (private.is_member(organization_id, array['OWNER','ADMIN','INVENTORY_MANAGER']::org_role[]));
create policy product_gs1_read on product_gs1 for select to authenticated using (private.is_member(organization_id));
create policy product_gs1_write on product_gs1 for all to authenticated
  using (private.is_member(organization_id, array['OWNER','ADMIN','INVENTORY_MANAGER']::org_role[])) with check (private.is_member(organization_id, array['OWNER','ADMIN','INVENTORY_MANAGER']::org_role[]));
revoke all on gs1_counters from anon, authenticated;
grant select, insert, update, delete on gs1_settings, gs1_counters, product_gtins, product_gs1 to service_role;

-- ---------- Funciones ----------
-- Próximo número correlativo (atómico) para GTIN, GLN, SSCC o códigos internos de la empresa.
create function public.gs1_next(p_org uuid, p_kind text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v bigint; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES']::public.org_role[]) then raise exception 'FORBIDDEN: no tenés permiso para asignar códigos'; end if;
  if p_kind not in ('GTIN', 'GLN', 'SSCC', 'INTERNAL') then raise exception 'INVALID_KIND'; end if;
  insert into public.gs1_counters(organization_id, kind, next_value) values (p_org, p_kind, 2)
    on conflict (organization_id, kind) do update set next_value = public.gs1_counters.next_value + 1
    returning next_value - 1 into v;
  return v; end $$;

-- GLN de un depósito (null lo borra).
create function public.set_warehouse_gln(p_org uuid, p_wh uuid, p_gln text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member(p_org, array['OWNER','ADMIN','INVENTORY_MANAGER']::public.org_role[]) then raise exception 'FORBIDDEN: no tenés permiso para cambiar depósitos'; end if;
  if p_gln is not null and (p_gln !~ '^[0-9]{13}$' or not public.gs1_valid(p_gln)) then raise exception 'INVALID_GLN: el GLN no es válido (13 dígitos con dígito de control)'; end if;
  update public.warehouses set gln = p_gln where id = p_wh and organization_id = p_org;
  if not found then raise exception 'INVALID_WAREHOUSE: el depósito no existe'; end if; end $$;

-- SSCC de un envío saliente (identifica la unidad logística y se imprime en la etiqueta).
create function public.set_shipment_sscc(p_shipment uuid, p_sscc text) returns void
language plpgsql security definer set search_path = '' as $$
declare s record; begin
  select * into s from public.shipments where id = p_shipment;
  if s.id is null then raise exception 'INVALID_SHIPMENT: el envío no existe'; end if;
  if not private.is_member(s.from_org, array['OWNER','ADMIN','INVENTORY_MANAGER','SALES']::public.org_role[]) then raise exception 'FORBIDDEN: solo la empresa que despacha puede asignar el SSCC'; end if;
  if s.sscc is not null then raise exception 'SSCC_EXISTS: este envío ya tiene SSCC'; end if;
  if p_sscc !~ '^[0-9]{18}$' or not public.gs1_valid(p_sscc) then raise exception 'INVALID_SSCC: el SSCC no es válido'; end if;
  update public.shipments set sscc = p_sscc where id = p_shipment; end $$;

-- Resolvedor público: devuelve SOLO datos de producto y lote de empresas que activaron las páginas públicas (nunca stock ni precios).
create function public.gs1_resolve(p_gtin text, p_lot text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g14 text := lpad(regexp_replace(coalesce(p_gtin, ''), '[^0-9]', '', 'g'), 14, '0'); r record; l record; lvl text := 'UNIT'; upp numeric := 1; begin
  if g14 !~ '^[0-9]{14}$' or not public.gs1_valid(g14) then return jsonb_build_object('found', false, 'reason', 'invalid'); end if;
  select p.id, p.name, o.display_name as org_name into r
    from public.products p join public.organizations o on o.id = p.organization_id join public.gs1_settings s on s.organization_id = p.organization_id and s.public_enabled
    where p.is_active and p.gtin is not null and lpad(p.gtin, 14, '0') = g14 order by s.updated_at desc limit 1;
  if r.id is null then
    select p.id, p.name, o.display_name as org_name, k.level, k.units_per_pack into r
      from public.product_gtins k join public.products p on p.id = k.product_id and p.is_active join public.organizations o on o.id = p.organization_id
      join public.gs1_settings s on s.organization_id = p.organization_id and s.public_enabled
      where lpad(k.gtin, 14, '0') = g14 order by s.updated_at desc limit 1;
    if r.id is not null then lvl := r.level; upp := r.units_per_pack; end if;
  end if;
  if r.id is null then return jsonb_build_object('found', false, 'reason', 'unknown'); end if;
  if p_lot is not null then select lot_number, expiration_date, production_date into l from public.lots where product_id = r.id and lot_number = p_lot; end if;
  return jsonb_build_object('found', true, 'gtin', g14, 'level', lvl, 'units_per_pack', upp, 'organization', r.org_name, 'name', r.name,
    'master', (select to_jsonb(m) - 'product_id' - 'organization_id' - 'updated_at' from public.product_gs1 m where m.product_id = r.id),
    'lot', case when l.lot_number is not null then jsonb_build_object('lot_number', l.lot_number, 'expiration_date', l.expiration_date, 'production_date', l.production_date) else null end); end $$;

revoke all on function public.gs1_next, public.set_warehouse_gln, public.set_shipment_sscc from public, anon;
grant execute on function public.gs1_next, public.set_warehouse_gln, public.set_shipment_sscc to authenticated;
revoke all on function public.gs1_resolve from public;
grant execute on function public.gs1_resolve to anon, authenticated;
notify pgrst, 'reload schema';
