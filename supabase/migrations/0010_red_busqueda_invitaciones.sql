-- 0010: Buscar empresas en la red (por email, teléfono o CUIT), conectarlas como cliente o proveedor, e invitar a las que no usan la aplicación.
-- Ejecutar DESPUÉS de 0009. No borra datos.

-- Cómo se puede encontrar a una empresa: CUIT (siempre, como ya pasaba al conectar) y, si lo permite, su email y teléfono de contacto.
create table network_profile (
  organization_id uuid primary key references organizations on delete cascade,
  contact_email text check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[0-9+()\s.-]{6,25}$'),
  searchable boolean not null default true,
  updated_at timestamptz not null default now());
alter table network_profile enable row level security;
create policy network_profile_read on network_profile for select to authenticated using (private.is_member(organization_id));
create policy network_profile_write on network_profile for all to authenticated
  using (public.has_perm(organization_id, 'network', 'edit')) with check (public.has_perm(organization_id, 'network', 'edit'));
grant select, insert, update, delete on network_profile to service_role;

-- Un cliente puede estar conectado a una empresa de la red (los proveedores ya tenían linked_org_id).
alter table customers add column linked_org_id uuid references organizations;

-- Las invitaciones ahora pueden ser por email, teléfono o CUIT, y recuerdan a qué cliente o proveedor corresponden.
alter table invitations alter column email drop not null;
alter table invitations add column contact_phone text, add column tax_id text, add column invited_name text,
  add column link_kind text check (link_kind in ('customer', 'supplier')), add column link_id uuid;
alter table invitations add constraint invitations_contact_check check (email is not null or contact_phone is not null or tax_id is not null);

-- Búsqueda exacta (no se puede recorrer el directorio): devuelve empresas que coinciden con un email, un teléfono o un CUIT completos.
create function public.search_network(p_org uuid, p_q text) returns table(org_id uuid, name text, tax_masked text, relation text)
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_q, '')); d text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g'); begin
  if not public.has_perm(p_org, 'network', 'view') then raise exception 'FORBIDDEN: tu rol no permite buscar en la red'; end if;
  if length(q) < 6 then raise exception 'SHORT_QUERY: escribí el email, el teléfono o el CUIT completo'; end if;
  return query
  select o.id, o.display_name,
         coalesce(substr(o.tax_id, 1, 2) || '-' || repeat('*', greatest(length(o.tax_id) - 3, 0)) || right(o.tax_id, 1), '')::text,
         (select r.status from public.business_relationships r where (r.organization_a = o.id and r.organization_b = p_org) or (r.organization_b = o.id and r.organization_a = p_org) order by r.status limit 1)::text
  from public.organizations o left join public.network_profile np on np.organization_id = o.id
  where o.id <> p_org and (
        (position('@' in q) > 0 and coalesce(np.searchable, false) and lower(np.contact_email) = lower(q))
     or (length(d) = 11 and regexp_replace(coalesce(o.tax_id, ''), '[^0-9]', '', 'g') = d)
     or (position('@' in q) = 0 and length(d) between 8 and 15 and coalesce(np.searchable, false) and np.contact_phone is not null
         and length(regexp_replace(np.contact_phone, '[^0-9]', '', 'g')) >= 8 and right(regexp_replace(np.contact_phone, '[^0-9]', '', 'g'), 8) = right(d, 8)))
  limit 5; end $$;

-- Conecta con una empresa encontrada (solicitud de conexión) y la agrega a tu lista de clientes o proveedores con sus datos fiscales.
create function public.add_partner_from_network(p_org uuid, p_target uuid, p_kind text, p_iva int default 1) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t record; rid uuid; ok_tax boolean; begin
  if p_kind not in ('customer', 'supplier') then raise exception 'INVALID_KIND: elegí cliente o proveedor'; end if;
  if not public.has_perm(p_org, 'network', 'create') then raise exception 'FORBIDDEN: tu rol no permite conectar empresas'; end if;
  if p_kind = 'customer' and not public.has_perm(p_org, 'sales', 'create') then raise exception 'FORBIDDEN: tu rol no permite crear clientes'; end if;
  if p_kind = 'supplier' and not public.has_perm(p_org, 'purchases', 'create') then raise exception 'FORBIDDEN: tu rol no permite crear proveedores'; end if;
  select o.id, o.legal_name, o.display_name, o.tax_id into t from public.organizations o where o.id = p_target;
  if t.id is null or p_target = p_org then raise exception 'INVALID_COMPANY: la empresa no existe'; end if;
  ok_tax := coalesce(t.tax_id, '') ~ '^[0-9]{11}$';
  if not exists (select 1 from public.business_relationships r where (r.organization_a = p_org and r.organization_b = p_target) or (r.organization_a = p_target and r.organization_b = p_org)) then
    insert into public.business_relationships(organization_a, organization_b, status) values (p_org, p_target, 'PENDING');
  end if;
  if p_kind = 'customer' then
    select c.id into rid from public.customers c where c.organization_id = p_org and c.is_active and (c.linked_org_id = p_target or (ok_tax and c.doc_type = 80 and c.doc_number = t.tax_id)) limit 1;
    if rid is not null then update public.customers set linked_org_id = p_target where id = rid;
    else insert into public.customers(organization_id, name, doc_type, doc_number, iva_condition, linked_org_id)
         values (p_org, coalesce(t.legal_name, t.display_name), case when ok_tax then 80 else 99 end, case when ok_tax then t.tax_id else '0' end, coalesce(p_iva, 1), p_target) returning id into rid; end if;
  else
    select s.id into rid from public.suppliers s where s.organization_id = p_org and s.is_active and (s.linked_org_id = p_target or (ok_tax and s.cuit = t.tax_id)) limit 1;
    if rid is not null then update public.suppliers set linked_org_id = p_target where id = rid;
    else insert into public.suppliers(organization_id, name, cuit, linked_org_id) values (p_org, coalesce(t.legal_name, t.display_name), case when ok_tax then t.tax_id else null end, p_target) returning id into rid; end if;
  end if;
  return rid; end $$;

-- Invita a una empresa que no usa la aplicación: la agrega a tu lista y deja un enlace de invitación (por email, teléfono o CUIT).
-- Cuando se registre con ese enlace, queda conectada y vinculada a ese cliente o proveedor.
create function public.invite_company(p_org uuid, p_kind text, p_name text, p_email text, p_phone text, p_tax_id text, p_iva int default 1) returns text
language plpgsql security definer set search_path = '' as $$
declare em text := nullif(lower(btrim(coalesce(p_email, ''))), ''); ph text := nullif(btrim(coalesce(p_phone, '')), ''); tx text := nullif(regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g'), '');
        nm text := nullif(btrim(coalesce(p_name, '')), ''); rid uuid; tok text; begin
  if p_kind not in ('customer', 'supplier') then raise exception 'INVALID_KIND: elegí cliente o proveedor'; end if;
  if not public.has_perm(p_org, 'network', 'create') then raise exception 'FORBIDDEN: tu rol no permite invitar empresas'; end if;
  if p_kind = 'customer' and not public.has_perm(p_org, 'sales', 'create') then raise exception 'FORBIDDEN: tu rol no permite crear clientes'; end if;
  if p_kind = 'supplier' and not public.has_perm(p_org, 'purchases', 'create') then raise exception 'FORBIDDEN: tu rol no permite crear proveedores'; end if;
  if nm is null then raise exception 'NAME_REQUIRED: indicá el nombre de la empresa'; end if;
  if em is null and ph is null and tx is null then raise exception 'CONTACT_REQUIRED: indicá al menos un email, un teléfono o un CUIT'; end if;
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL: el email no es válido'; end if;
  if ph is not null and ph !~ '^[0-9+()\s.-]{6,25}$' then raise exception 'INVALID_PHONE: el teléfono no es válido'; end if;
  if tx is not null and length(tx) <> 11 then raise exception 'INVALID_TAX_ID: el CUIT tiene 11 dígitos'; end if;
  if (tx is not null and exists (select 1 from public.organizations o where regexp_replace(coalesce(o.tax_id, ''), '[^0-9]', '', 'g') = tx and o.id <> p_org))
     or (em is not null and exists (select 1 from public.network_profile np where lower(np.contact_email) = em and np.searchable and np.organization_id <> p_org)) then
    raise exception 'ALREADY_REGISTERED: esa empresa ya usa la aplicación: buscala en la red y conectala'; end if;
  if p_kind = 'customer' then
    select c.id into rid from public.customers c where c.organization_id = p_org and c.is_active and tx is not null and c.doc_type = 80 and c.doc_number = tx limit 1;
    if rid is null then insert into public.customers(organization_id, name, doc_type, doc_number, iva_condition, email, phone)
      values (p_org, nm, case when tx is not null then 80 else 99 end, coalesce(tx, '0'), coalesce(p_iva, 1), em, ph) returning id into rid; end if;
  else
    select s.id into rid from public.suppliers s where s.organization_id = p_org and s.is_active and tx is not null and s.cuit = tx limit 1;
    if rid is null then insert into public.suppliers(organization_id, name, cuit, email, phone) values (p_org, nm, tx, em, ph) returning id into rid; end if;
  end if;
  insert into public.invitations(organization_id, email, contact_phone, tax_id, invited_name, link_kind, link_id) values (p_org, em, ph, tx, nm, p_kind, rid) returning token into tok;
  return tok; end $$;

-- Al registrarse con el enlace: queda conectada y se vincula con el cliente o proveedor que la invitó.
create or replace function public.redeem_invitation(p_token text, p_my_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invitations; begin
  if not private.is_member(p_my_org, array['OWNER','ADMIN']::public.org_role[]) then raise exception 'FORBIDDEN'; end if;
  select * into i from public.invitations where token = p_token and status = 'PENDING' for update;
  if i.id is null then return; end if;
  insert into public.business_relationships(organization_a, organization_b, status) values (i.organization_id, p_my_org, 'ACTIVE') on conflict do nothing;
  if i.link_kind = 'customer' and i.link_id is not null then update public.customers set linked_org_id = p_my_org where id = i.link_id and organization_id = i.organization_id and linked_org_id is null;
  elsif i.link_kind = 'supplier' and i.link_id is not null then update public.suppliers set linked_org_id = p_my_org where id = i.link_id and organization_id = i.organization_id and linked_org_id is null; end if;
  update public.invitations set status = 'ACCEPTED' where id = i.id; end $$;

revoke all on function public.search_network, public.add_partner_from_network, public.invite_company from public, anon;
grant execute on function public.search_network, public.add_partner_from_network, public.invite_company to authenticated;
notify pgrst, 'reload schema';
