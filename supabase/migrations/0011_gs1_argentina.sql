-- 0011: API de consulta de GS1 Argentina (datos oficiales de un GTIN). Ejecutar DESPUÉS de 0009. No borra datos.

-- Credenciales de la empresa ante GS1 Argentina (usuario, clientid y contraseña cifrada). Una por ambiente; solo una activa.
-- Sin políticas: solo las lee el servidor, después de verificar el rol.
create table gs1ar_accounts (
  organization_id uuid not null references organizations on delete cascade,
  environment text not null check (environment in ('testing', 'production')),
  username text not null, clientid text not null, password_enc text not null,
  is_active boolean not null default true, updated_at timestamptz not null default now(),
  primary key (organization_id, environment));
create unique index gs1ar_accounts_one_active on gs1ar_accounts (organization_id) where is_active;

-- Token vigente (GS1 lo entrega por 24 horas): se guarda cifrado para no pedirlo en cada consulta.
create table gs1ar_tokens (
  organization_id uuid not null, environment text not null,
  token_enc text not null, expires_at timestamptz not null,
  primary key (organization_id, environment),
  foreign key (organization_id, environment) references gs1ar_accounts on delete cascade);

-- Caché de consultas (por empresa): evita repetir pedidos a GS1 por el mismo GTIN.
create table gs1ar_products (
  organization_id uuid not null references organizations on delete cascade,
  environment text not null, gtin varchar(14) not null,
  found boolean not null, data jsonb, message text, fetched_at timestamptz not null default now(),
  primary key (organization_id, environment, gtin));

-- Registro de pedidos y respuestas (GS1 lo recomienda para diagnosticar problemas). Nunca guarda contraseñas ni tokens.
create table gs1ar_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations on delete cascade,
  environment text not null, action text not null check (action in ('token', 'gtin')),
  gtin text, http_status int, ok boolean not null, message text, ms int, created_at timestamptz not null default now());
create index gs1ar_log_idx on gs1ar_log (organization_id, created_at desc);

alter table gs1ar_accounts enable row level security;
alter table gs1ar_tokens enable row level security;
alter table gs1ar_products enable row level security;
alter table gs1ar_log enable row level security;
revoke all on gs1ar_accounts, gs1ar_tokens from anon, authenticated;
create policy gs1ar_products_read on gs1ar_products for select to authenticated using (public.has_perm(organization_id, 'gs1', 'view'));
create policy gs1ar_log_read on gs1ar_log for select to authenticated using (public.has_perm(organization_id, 'gs1', 'edit'));
revoke insert, update, delete on gs1ar_products, gs1ar_log from anon, authenticated;
grant all on gs1ar_accounts, gs1ar_tokens, gs1ar_products, gs1ar_log to service_role;
notify pgrst, 'reload schema';
