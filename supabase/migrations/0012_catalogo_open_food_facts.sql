-- 0012: Catálogo público de Open Food Facts (OFF): productos asociados a Argentina identificados por GTIN, con su procedencia y licencia.
-- Ejecutar DESPUÉS de 0011. No toca tus productos: el catálogo público vive en tablas aparte y solo se copia a tu empresa si vos lo pedís.

-- Fuentes de datos y sus derechos: cada fuente declara su licencia y la leyenda de atribución que debe mostrarse.
create table catalog_sources (
  source text primary key, name text not null, license text not null, license_url text, attribution text not null,
  homepage text, redistributable boolean not null default false, notes text);
insert into catalog_sources (source, name, license, license_url, attribution, homepage, redistributable, notes) values
 ('off', 'Open Food Facts', 'ODbL 1.0', 'https://opendatacommons.org/licenses/odbl/1-0/',
  'Contiene información de Open Food Facts (openfoodfacts.org), disponible bajo la licencia Open Database License (ODbL) 1.0.', 'https://world.openfoodfacts.org/', true,
  'Base bajo ODbL; los contenidos individuales bajo DbCL. Antes de redistribuir o combinar la base con otras, verificar las obligaciones de atribución y de compartir igual.'),
 ('gs1ar', 'GS1 Argentina', 'Licencia de uso de GS1 Argentina', null, 'Datos de GS1 Argentina', null, false,
  'Uso sujeto a las condiciones de GS1 Argentina. No mezclar con fuentes abiertas.');

-- Productos de OFF. El GTIN se guarda siempre como texto (con ceros iniciales). `gtin14` es el código normalizado para buscar;
-- `code` es el código tal como lo informa OFF. No es la clave de tus productos: cada registro tiene su propio id.
create table off_products (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'off' references catalog_sources,
  code text not null,
  gtin14 varchar(14) not null,
  gtin_kind text not null check (gtin_kind in ('GTIN-8', 'GTIN-12', 'GTIN-13', 'GTIN-14')),
  product_name text, generic_name text, brands text, quantity text,
  countries_tags text[] not null default '{}',
  in_argentina boolean not null default false,          -- OFF lo asocia a Argentina (no prueba que hoy se venda allí)
  origin text not null check (origin in ('bulk', 'delta', 'on_demand')),
  off_last_modified_at timestamptz,                     -- última modificación en OFF (last_modified_t)
  imported_at timestamptz not null default now(),       -- primera importación
  updated_at timestamptz not null default now(),        -- última actualización local
  last_seen_at timestamptz, last_seen_run uuid,         -- última aparición en una exportación
  first_run uuid,
  constraint off_products_gtin14_unique unique (gtin14),
  constraint off_products_gtin_digits check (gtin14 ~ '^[0-9]{14}$' and code ~ '^[0-9]{8,14}$'));
create index off_products_argentina on off_products (in_argentina) where in_argentina;
create index off_products_seen on off_products (last_seen_run);

-- Caché negativa: GTIN que OFF no tiene (los errores de conexión NO se guardan acá).
create table off_lookups (
  gtin14 varchar(14) primary key, status text not null check (status in ('not_found')),
  checked_at timestamptz not null default now(), expires_at timestamptz not null);

-- Registro de importaciones. Solo puede haber una en curso.
create table off_import_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('full', 'delta')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'interrupted')),
  source_label text, source_url text,
  started_at timestamptz not null default now(), finished_at timestamptz, heartbeat_at timestamptz not null default now(),
  rows_read int not null default 0, processed int not null default 0, inserted int not null default 0, updated int not null default 0,
  unchanged int not null default 0, rejected int not null default 0, errors int not null default 0,
  watermark_t bigint,                -- hasta qué momento (UNIX) cubre esta ejecución
  cursor jsonb,                      -- para reanudar
  error_summary text);
create unique index off_one_running_import on off_import_runs ((true)) where status = 'running';
create table off_import_issues (
  id bigint generated always as identity primary key, run_id uuid not null references off_import_runs on delete cascade,
  code text, reason text not null, created_at timestamptz not null default now());
create index off_import_issues_run on off_import_issues (run_id);

create table off_alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('import_failed', 'count_drop', 'api_down', 'rate_limited', 'validation_errors')),
  message text not null, detail jsonb, created_at timestamptz not null default now(), resolved_at timestamptz);
create index off_alerts_open on off_alerts (kind, created_at desc) where resolved_at is null;

-- Control compartido entre instancias: límite de consultas por minuto, consultas en curso y estado del "circuito" ante fallas.
create table off_rate (bucket text not null, window_start timestamptz not null, n int not null default 0, primary key (bucket, window_start));
create table off_inflight (gtin14 varchar(14) primary key, started_at timestamptz not null default now());
create table off_state (key text primary key, value jsonb not null, updated_at timestamptz not null default now());

-- Cuenta una consulta en la ventana del minuto actual; devuelve false si ya se alcanzó el límite.
create function public.off_acquire(p_bucket text, p_limit int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare c int; begin
  insert into public.off_rate(bucket, window_start, n) values (p_bucket, date_trunc('minute', now()), 1)
    on conflict (bucket, window_start) do update set n = public.off_rate.n + 1 returning n into c;
  delete from public.off_rate where window_start < now() - interval '1 hour';
  return c <= p_limit; end $$;
-- Reserva un GTIN para consultarlo (si otra solicitud ya lo está consultando hace menos de p_ttl segundos, devuelve false).
create function public.off_claim(p_gtin text, p_ttl int default 30) returns boolean
language plpgsql security definer set search_path = '' as $$
declare got boolean; begin
  insert into public.off_inflight(gtin14, started_at) values (p_gtin, now())
    on conflict (gtin14) do update set started_at = now() where public.off_inflight.started_at < now() - make_interval(secs => p_ttl)
    returning true into got;
  return coalesce(got, false); end $$;
create function public.off_release(p_gtin text) returns void
language sql security definer set search_path = '' as $$ delete from public.off_inflight where gtin14 = p_gtin $$;
-- Marca como vistos en la ejecución a los productos que no cambiaron.
create function public.off_touch(p_run uuid, p_gtins text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; begin
  update public.off_products set last_seen_at = now(), last_seen_run = p_run where gtin14 = any(p_gtins);
  get diagnostics n = row_count; return n; end $$;

-- Procedencia en las fichas de tu empresa: de dónde salieron los datos que copiaste.
alter table product_gs1 add column data_source text, add column data_source_at timestamptz;

-- Permisos: el catálogo público y las fuentes se pueden leer; todo lo demás lo maneja solo el servidor.
alter table catalog_sources enable row level security;
alter table off_products enable row level security;
alter table off_lookups enable row level security;
alter table off_import_runs enable row level security;
alter table off_import_issues enable row level security;
alter table off_alerts enable row level security;
alter table off_rate enable row level security;
alter table off_inflight enable row level security;
alter table off_state enable row level security;
create policy catalog_sources_read on catalog_sources for select to authenticated using (true);
create policy off_products_read on off_products for select to authenticated using (true);
create policy off_runs_read on off_import_runs for select to authenticated using (exists (select 1 from public.memberships m where m.user_id = auth.uid() and public.has_perm(m.organization_id, 'gs1', 'edit')));
create policy off_alerts_read on off_alerts for select to authenticated using (exists (select 1 from public.memberships m where m.user_id = auth.uid() and public.has_perm(m.organization_id, 'gs1', 'edit')));
revoke all on off_products, catalog_sources, off_lookups, off_import_runs, off_import_issues, off_alerts, off_rate, off_inflight, off_state from anon;
revoke insert, update, delete on off_products, catalog_sources, off_import_runs, off_alerts from authenticated;
revoke all on off_lookups, off_import_issues, off_rate, off_inflight, off_state from authenticated;
grant all on catalog_sources, off_products, off_lookups, off_import_runs, off_import_issues, off_alerts, off_rate, off_inflight, off_state to service_role;
revoke all on function public.off_acquire, public.off_claim, public.off_release, public.off_touch from public, anon, authenticated;
grant execute on function public.off_acquire, public.off_claim, public.off_release, public.off_touch to service_role;
notify pgrst, 'reload schema';
