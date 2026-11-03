-- 0009: Usuarios y permisos, proveedores y compras, y reportes de la red.
-- Ejecutar DESPUÉS de 0008. No borra datos.

-- =====================================================================
-- A) USUARIOS Y PERMISOS: roles de negocio con permisos por módulo y acción
-- =====================================================================
-- Roles: dueño (acceso total), administrador, encargado, trabajador, auditor. Cada rol tiene, por módulo, permisos independientes
-- para consultar, crear, editar, eliminar y autorizar. Los valores por defecto están en default_perm() y cada empresa los puede cambiar.
alter table memberships add column role_key text check (role_key in ('admin', 'manager', 'worker', 'auditor'));

create table org_role_perms (
  organization_id uuid not null references organizations on delete cascade,
  role_key text not null check (role_key in ('admin', 'manager', 'worker', 'auditor')),
  module text not null check (module in ('inventory', 'sales', 'invoicing', 'purchases', 'network', 'gs1', 'reports', 'users')),
  action text not null check (action in ('view', 'create', 'edit', 'delete', 'approve')),
  allowed boolean not null,
  primary key (organization_id, role_key, module, action));
create table member_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  email text not null, role_key text not null check (role_key in ('admin', 'manager', 'worker', 'auditor')),
  invited_by uuid default auth.uid(), created_at timestamptz not null default now(), accepted_at timestamptz);
create unique index member_invites_pending on member_invites (organization_id, lower(email)) where accepted_at is null;

create function public.default_perm(rk text, m text, a text) returns boolean
language sql immutable as $$
  select case rk when 'owner' then true
    when 'admin' then (m || ':' || a) = any (array['inventory:view', 'inventory:create', 'inventory:edit', 'inventory:delete', 'inventory:approve', 'sales:view', 'sales:create', 'sales:edit', 'sales:delete', 'sales:approve', 'invoicing:view', 'invoicing:create', 'invoicing:edit', 'invoicing:delete', 'invoicing:approve', 'purchases:view', 'purchases:create', 'purchases:edit', 'purchases:delete', 'purchases:approve', 'network:view', 'network:create', 'network:edit', 'network:delete', 'network:approve', 'gs1:view', 'gs1:create', 'gs1:edit', 'gs1:delete', 'gs1:approve', 'reports:view', 'reports:create', 'reports:edit', 'reports:delete', 'reports:approve', 'users:view', 'users:create', 'users:edit', 'users:delete', 'users:approve'])
    when 'manager' then (m || ':' || a) = any (array['inventory:view', 'inventory:create', 'inventory:edit', 'inventory:delete', 'inventory:approve', 'sales:view', 'sales:create', 'sales:edit', 'invoicing:view', 'invoicing:create', 'purchases:view', 'purchases:create', 'purchases:edit', 'purchases:approve', 'network:view', 'network:create', 'network:edit', 'network:approve', 'gs1:view', 'gs1:create', 'gs1:edit', 'reports:view'])
    when 'worker' then (m || ':' || a) = any (array['inventory:view', 'inventory:create', 'inventory:edit', 'sales:view', 'sales:create', 'invoicing:view', 'purchases:view', 'purchases:create', 'network:view', 'gs1:view'])
    when 'auditor' then (m || ':' || a) = any (array['inventory:view', 'sales:view', 'invoicing:view', 'purchases:view', 'network:view', 'gs1:view', 'reports:view', 'users:view'])
    else false end $$;

-- Rol de negocio equivalente al rol histórico, y a la inversa (los controles anteriores de la base siguen usando el rol histórico).
create function public.legacy_role(rk text) returns public.org_role language sql immutable as $$
  select (case rk when 'admin' then 'ADMIN' when 'manager' then 'INVENTORY_MANAGER' when 'worker' then 'WAREHOUSE' else 'VIEWER' end)::public.org_role $$;
create function public.role_key_of(p_org uuid, p_user uuid default auth.uid()) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(m.role_key, case m.role::text when 'OWNER' then 'owner' when 'ADMIN' then 'admin' when 'INVENTORY_MANAGER' then 'manager' when 'VIEWER' then 'auditor' else 'worker' end)
  from public.memberships m where m.organization_id = p_org and m.user_id = p_user $$;
create function public.has_perm(p_org uuid, p_module text, p_action text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare rk text; v boolean; begin
  rk := public.role_key_of(p_org, auth.uid());
  if rk is null then return false; end if;
  if rk = 'owner' then return true; end if;
  select allowed into v from public.org_role_perms where organization_id = p_org and role_key = rk and module = p_module and action = p_action;
  return coalesce(v, public.default_perm(rk, p_module, p_action)); end $$;

alter table org_role_perms enable row level security;
alter table member_invites enable row level security;
create policy org_role_perms_read on org_role_perms for select to authenticated using (private.is_member(organization_id));
create policy member_invites_read on member_invites for select to authenticated using (public.has_perm(organization_id, 'users', 'view'));
revoke insert, update, delete on org_role_perms, member_invites from anon, authenticated;
grant select, insert, update, delete on org_role_perms, member_invites to service_role;

create function public.list_team(p_org uuid) returns table(user_id uuid, email text, role_key text, is_you boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm(p_org, 'users', 'view') then raise exception 'FORBIDDEN: tu rol no permite ver los usuarios'; end if;
  return query select m.user_id, u.email::text, public.role_key_of(p_org, m.user_id), m.user_id = auth.uid()
    from public.memberships m join auth.users u on u.id = m.user_id where m.organization_id = p_org order by 3, 2; end $$;

create function public.invite_member(p_org uuid, p_email text, p_role_key text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid; em text := lower(btrim(coalesce(p_email, ''))); begin
  if not public.has_perm(p_org, 'users', 'create') then raise exception 'FORBIDDEN: tu rol no permite agregar usuarios'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL: el email no es válido'; end if;
  if p_role_key not in ('admin', 'manager', 'worker', 'auditor') then raise exception 'INVALID_ROLE: elegí un rol'; end if;
  select id into uid from auth.users where lower(email) = em;
  if uid is not null then
    if exists (select 1 from public.memberships where organization_id = p_org and user_id = uid) then raise exception 'ALREADY_MEMBER: esa persona ya es parte de la empresa'; end if;
    insert into public.memberships(organization_id, user_id, role, role_key) values (p_org, uid, public.legacy_role(p_role_key), p_role_key);
    return 'ADDED';
  end if;
  insert into public.member_invites(organization_id, email, role_key) values (p_org, em, p_role_key)
    on conflict (organization_id, lower(email)) where accepted_at is null do update set role_key = excluded.role_key;
  return 'INVITED'; end $$;

-- Al ingresar, la persona recibe automáticamente las invitaciones pendientes de su email.
create function public.claim_member_invites() returns integer
language plpgsql security definer set search_path = '' as $$
declare em text; i record; n integer := 0; begin
  select lower(email) into em from auth.users where id = auth.uid();
  if em is null then return 0; end if;
  for i in select * from public.member_invites where lower(email) = em and accepted_at is null loop
    insert into public.memberships(organization_id, user_id, role, role_key) values (i.organization_id, auth.uid(), public.legacy_role(i.role_key), i.role_key) on conflict do nothing;
    update public.member_invites set accepted_at = now() where id = i.id; n := n + 1;
  end loop; return n; end $$;

create function public.set_member_role(p_org uuid, p_user uuid, p_role_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare cur public.org_role; begin
  if not public.has_perm(p_org, 'users', 'edit') then raise exception 'FORBIDDEN: tu rol no permite cambiar roles'; end if;
  if p_role_key not in ('admin', 'manager', 'worker', 'auditor') then raise exception 'INVALID_ROLE: elegí un rol'; end if;
  select role into cur from public.memberships where organization_id = p_org and user_id = p_user;
  if cur is null then raise exception 'INVALID_MEMBER: la persona no pertenece a la empresa'; end if;
  if cur = 'OWNER' then raise exception 'OWNER_LOCKED: el rol del dueño no se puede cambiar'; end if;
  if p_user = auth.uid() then raise exception 'SELF_CHANGE: no podés cambiar tu propio rol'; end if;
  update public.memberships set role = public.legacy_role(p_role_key), role_key = p_role_key where organization_id = p_org and user_id = p_user; end $$;

create function public.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cur public.org_role; begin
  if not public.has_perm(p_org, 'users', 'delete') then raise exception 'FORBIDDEN: tu rol no permite quitar usuarios'; end if;
  select role into cur from public.memberships where organization_id = p_org and user_id = p_user;
  if cur is null then raise exception 'INVALID_MEMBER: la persona no pertenece a la empresa'; end if;
  if cur = 'OWNER' then raise exception 'OWNER_LOCKED: no se puede quitar al dueño'; end if;
  if p_user = auth.uid() then raise exception 'SELF_CHANGE: no podés quitarte a vos mismo'; end if;
  delete from public.memberships where organization_id = p_org and user_id = p_user; end $$;

create function public.cancel_invite(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_perm(p_org, 'users', 'delete') then raise exception 'FORBIDDEN: tu rol no permite cancelar invitaciones'; end if;
  delete from public.member_invites where id = p_id and organization_id = p_org and accepted_at is null; end $$;

-- Guarda de una vez los permisos de un rol: [{"module":"sales","action":"create","allowed":true}, …]
create function public.set_role_perms(p_org uuid, p_role_key text, p_perms jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare e jsonb; begin
  if not public.has_perm(p_org, 'users', 'edit') then raise exception 'FORBIDDEN: tu rol no permite cambiar permisos'; end if;
  if p_role_key not in ('admin', 'manager', 'worker', 'auditor') then raise exception 'INVALID_ROLE: el rol del dueño no se modifica'; end if;
  if p_perms is null or jsonb_typeof(p_perms) <> 'array' then raise exception 'INVALID_PERMS'; end if;
  for e in select * from jsonb_array_elements(p_perms) loop
    insert into public.org_role_perms(organization_id, role_key, module, action, allowed)
      values (p_org, p_role_key, e->>'module', e->>'action', (e->>'allowed')::boolean)
      on conflict (organization_id, role_key, module, action) do update set allowed = excluded.allowed;
  end loop; end $$;

-- Los controles de las funciones nuevas usan la matriz de permisos; estas dos funciones anteriores también.
create or replace function public.create_sale(p_org uuid, p_customer uuid, p_wh uuid, p_items jsonb, p_payment text default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid; it jsonb; prod record; a record; need numeric; take numeric; legs jsonb := '[]'::jsonb; ivak text; price numeric; begin
  if not public.has_perm(p_org, 'sales', 'create') then raise exception 'FORBIDDEN: tu rol no permite registrar ventas'; end if;
  if p_customer is not null and not exists (select 1 from public.customers where id = p_customer and organization_id = p_org and is_active) then raise exception 'INVALID_CUSTOMER: el cliente no existe'; end if;
  if not exists (select 1 from public.warehouses where id = p_wh and organization_id = p_org and is_active) then raise exception 'INVALID_WAREHOUSE: elegí el depósito del que sale la mercadería'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'EMPTY_SALE: agregá al menos un producto'; end if;
  insert into public.sales(organization_id, customer_id, warehouse_id, payment_method, notes)
    values (p_org, p_customer, p_wh, nullif(btrim(coalesce(p_payment, '')), ''), nullif(btrim(coalesce(p_notes, '')), '')) returning id into sid;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into prod from public.products where id = (it->>'product_id')::uuid and organization_id = p_org and is_active;
    if prod.id is null then raise exception 'INVALID_PRODUCT: un producto de la venta no existe'; end if;
    need := (it->>'qty')::numeric;
    if need is null or need <= 0 then raise exception 'INVALID_QUANTITY: las cantidades deben ser mayores que cero'; end if;
    price := (it->>'unit_price')::numeric;
    if price is null or price < 0 then raise exception 'INVALID_PRICE: el precio de % no es válido', prod.name; end if;
    ivak := coalesce(nullif(it->>'iva', ''), prod.iva);
    if ivak not in ('0','2.5','5','10.5','21','27','EX','NG') then raise exception 'INVALID_IVA: alícuota de IVA no válida'; end if;
    insert into public.sale_items(sale_id, organization_id, product_id, description, qty, unit_price, iva)
      values (sid, p_org, prod.id, coalesce(nullif(btrim(it->>'description'), ''), prod.name), (it->>'qty')::numeric, price, ivak);
    for a in select ip.lot_id, ip.quantity - ip.reserved as av
             from public.inventory_positions ip join public.lots l on l.id = ip.lot_id
             where ip.warehouse_id = p_wh and ip.product_id = prod.id and ip.quantity - ip.reserved > 0
             order by l.expiration_date nulls last, l.production_date nulls last, l.lot_number loop
      exit when need <= 0;
      take := least(a.av, need);
      legs := legs || jsonb_build_object('product_id', prod.id, 'lot_id', a.lot_id, 'from', p_wh, 'to', null, 'qty', take, 'type', 'SALE');
      need := need - take;
    end loop;
    if need > 0 then raise exception 'INSUFFICIENT_STOCK: no hay stock suficiente de % en el depósito (faltan %)', prod.name, need; end if;
  end loop;
  perform public.inventory_apply(p_org, 'SALE', legs, 'Venta ' || sid::text);
  return sid; end $$;

create or replace function public.delete_product(p_org uuid, p_product uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare stock numeric; begin
  if not public.has_perm(p_org, 'inventory', 'delete') then raise exception 'FORBIDDEN: tu rol no permite eliminar productos'; end if;
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

-- =====================================================================
-- B) PROVEEDORES Y COMPRAS
-- =====================================================================
alter table products add column avg_cost numeric(18,4) check (avg_cost is null or avg_cost >= 0);   -- costo promedio ponderado (neto por unidad)

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  name text not null, cuit text check (cuit is null or cuit ~ '^[0-9]{11}$'),
  contact_name text, email text, phone text, address text,
  payment_days int not null default 0 check (payment_days >= 0),
  delivery_days int check (delivery_days is null or delivery_days >= 0),
  min_order numeric(18,2) check (min_order is null or min_order >= 0),
  terms text,
  linked_org_id uuid references organizations,
  is_active boolean not null default true, created_at timestamptz not null default now());
create unique index suppliers_cuit_idx on suppliers (organization_id, cuit) where cuit is not null and is_active;

create table purchase_prices (                       -- historial de precios de compra (neto por unidad de medida)
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  supplier_id uuid not null references suppliers, product_id uuid not null references products,
  unit_price numeric(18,4) not null check (unit_price >= 0),
  quoted_at date not null default current_date,
  source text not null check (source in ('MANUAL', 'ORDER', 'RECEIPT')), reference text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now());
create index purchase_prices_idx on purchase_prices (organization_id, product_id, quoted_at desc);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  supplier_id uuid not null references suppliers, number int not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
  order_date date not null default current_date, expected_date date, payment_days int, notes text,
  approved_by uuid, approved_at timestamptz, created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  unique (organization_id, number));
create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders on delete cascade, organization_id uuid not null references organizations on delete cascade,
  product_id uuid not null references products,
  qty_ordered numeric(18,4) not null check (qty_ordered > 0), qty_received numeric(18,4) not null default 0 check (qty_received >= 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  iva text not null default '21' check (iva in ('0', '2.5', '5', '10.5', '21', '27', 'EX', 'NG')));
create table purchase_receipts (                     -- una recepción por entrega: permite recibir una orden en partes
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  po_id uuid not null references purchase_orders, supplier_id uuid not null references suppliers, warehouse_id uuid not null references warehouses,
  receipt_date date not null default current_date, note text, created_by uuid default auth.uid(), created_at timestamptz not null default now());
create table purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references purchase_receipts on delete cascade, organization_id uuid not null references organizations on delete cascade,
  po_item_id uuid not null references purchase_order_items, product_id uuid not null references products,
  lot_number text not null, expiration_date date, qty numeric(18,4) not null check (qty > 0), unit_price numeric(18,4) not null);
create table supplier_invoices (                     -- factura del proveedor vinculada a las recepciones (qué productos entraron con qué factura)
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  supplier_id uuid not null references suppliers,
  doc_type text not null default 'A' check (doc_type in ('A', 'B', 'C', 'M', 'X', 'NC', 'ND', 'OTRO')),
  pto_vta int not null default 0, number bigint not null check (number > 0), invoice_date date not null, due_date date,
  total_net numeric(15,2) not null check (total_net >= 0), total_iva numeric(15,2) not null default 0, total numeric(15,2) not null check (total >= 0),
  cae text, notes text, status text not null default 'PENDING' check (status in ('PENDING', 'PAID')), paid_at date,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  unique (organization_id, supplier_id, doc_type, pto_vta, number));
create table supplier_invoice_receipts (
  invoice_id uuid not null references supplier_invoices on delete cascade, receipt_id uuid not null references purchase_receipts,
  primary key (invoice_id, receipt_id), unique (receipt_id));
create index po_org_idx on purchase_orders (organization_id, created_at desc);
create index receipts_po_idx on purchase_receipts (po_id);

alter table suppliers enable row level security;
alter table purchase_prices enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;
alter table purchase_receipts enable row level security;
alter table purchase_receipt_items enable row level security;
alter table supplier_invoices enable row level security;
alter table supplier_invoice_receipts enable row level security;
create policy sup_read on suppliers for select to authenticated using (public.has_perm(organization_id, 'purchases', 'view'));
create policy sup_ins on suppliers for insert to authenticated with check (public.has_perm(organization_id, 'purchases', 'create'));
create policy sup_upd on suppliers for update to authenticated using (public.has_perm(organization_id, 'purchases', 'edit')) with check (public.has_perm(organization_id, 'purchases', 'edit'));
create policy pp_read on purchase_prices for select to authenticated using (public.has_perm(organization_id, 'purchases', 'view'));
create policy po_read on purchase_orders for select to authenticated using (public.has_perm(organization_id, 'purchases', 'view'));
create policy poi_read on purchase_order_items for select to authenticated using (public.has_perm(organization_id, 'purchases', 'view'));
create policy pr_read2 on purchase_receipts for select to authenticated using (public.has_perm(organization_id, 'purchases', 'view'));
create policy pri_read on purchase_receipt_items for select to authenticated using (public.has_perm(organization_id, 'purchases', 'view'));
create policy si_read on supplier_invoices for select to authenticated using (public.has_perm(organization_id, 'purchases', 'view'));
create policy sir_read on supplier_invoice_receipts for select to authenticated using (exists (select 1 from public.supplier_invoices i where i.id = invoice_id and public.has_perm(i.organization_id, 'purchases', 'view')));
revoke insert, update, delete on purchase_prices, purchase_orders, purchase_order_items, purchase_receipts, purchase_receipt_items, supplier_invoices, supplier_invoice_receipts from anon, authenticated;
revoke delete on suppliers from anon, authenticated;
grant select, insert, update, delete on suppliers, purchase_prices, purchase_orders, purchase_order_items, purchase_receipts, purchase_receipt_items, supplier_invoices, supplier_invoice_receipts to service_role;

create function public.create_purchase_order(p_org uuid, p_supplier uuid, p_items jsonb, p_expected date default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pid uuid; n int; it jsonb; prod uuid; q numeric; pr numeric; iv text; begin
  if not public.has_perm(p_org, 'purchases', 'create') then raise exception 'FORBIDDEN: tu rol no permite crear órdenes de compra'; end if;
  if not exists (select 1 from public.suppliers where id = p_supplier and organization_id = p_org and is_active) then raise exception 'INVALID_SUPPLIER: el proveedor no existe'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'EMPTY_ORDER: agregá al menos un producto'; end if;
  perform pg_advisory_xact_lock(hashtext('po:' || p_org::text));
  select coalesce(max(o.number), 0) + 1 into n from public.purchase_orders o where o.organization_id = p_org;
  insert into public.purchase_orders(organization_id, supplier_id, number, expected_date, notes, payment_days)
    values (p_org, p_supplier, n, p_expected, nullif(btrim(coalesce(p_notes, '')), ''), (select s.payment_days from public.suppliers s where s.id = p_supplier)) returning id into pid;
  for it in select * from jsonb_array_elements(p_items) loop
    prod := (it->>'product_id')::uuid; q := (it->>'qty')::numeric; pr := nullif(it->>'unit_price', '')::numeric;
    if not exists (select 1 from public.products x where x.id = prod and x.organization_id = p_org and x.is_active) then raise exception 'INVALID_PRODUCT: un producto de la orden no existe'; end if;
    if q is null or q <= 0 then raise exception 'INVALID_QUANTITY: las cantidades deben ser mayores que cero'; end if;
    if pr is null then
      select pp.unit_price into pr from public.purchase_prices pp where pp.organization_id = p_org and pp.supplier_id = p_supplier and pp.product_id = prod order by pp.quoted_at desc, pp.created_at desc limit 1;
    end if;
    if pr is null or pr < 0 then raise exception 'INVALID_PRICE: falta el precio de un producto y no hay un precio anterior de ese proveedor'; end if;
    iv := coalesce(nullif(it->>'iva', ''), (select x.iva from public.products x where x.id = prod));
    insert into public.purchase_order_items(po_id, organization_id, product_id, qty_ordered, unit_price, iva) values (pid, p_org, prod, q, pr, iv);
    insert into public.purchase_prices(organization_id, supplier_id, product_id, unit_price, source, reference) values (p_org, p_supplier, prod, pr, 'ORDER', 'OC ' || n);
  end loop;
  return pid; end $$;

create function public.approve_purchase_order(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare po record; begin
  select * into po from public.purchase_orders where id = p_id for update;
  if po.id is null then raise exception 'INVALID_PO: la orden no existe'; end if;
  if not public.has_perm(po.organization_id, 'purchases', 'approve') then raise exception 'FORBIDDEN: tu rol no permite autorizar órdenes de compra'; end if;
  if po.status <> 'DRAFT' then raise exception 'PO_STATE: solo se autoriza una orden en borrador'; end if;
  update public.purchase_orders set status = 'APPROVED', approved_by = auth.uid(), approved_at = now() where id = p_id; end $$;

create function public.cancel_purchase_order(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare po record; begin
  select * into po from public.purchase_orders where id = p_id for update;
  if po.id is null then raise exception 'INVALID_PO: la orden no existe'; end if;
  if not public.has_perm(po.organization_id, 'purchases', 'edit') then raise exception 'FORBIDDEN: tu rol no permite cancelar órdenes de compra'; end if;
  if po.status not in ('DRAFT', 'APPROVED') then raise exception 'PO_STATE: solo se cancela una orden sin mercadería recibida'; end if;
  update public.purchase_orders set status = 'CANCELLED' where id = p_id; end $$;

-- Recepción (total o parcial): ingresa el stock, actualiza el costo promedio, guarda el precio pagado y avanza el estado de la orden.
-- p_items: [{"item_id":"…","qty":5,"lot":"L-1","expires":"2027-01-31"}]
create function public.receive_purchase_order(p_id uuid, p_wh uuid, p_items jsonb, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare po record; it jsonb; poi record; q numeric; rid uuid; stock_before numeric; cur_avg numeric; new_avg numeric; lot text; exp date; got boolean := false; open_left numeric; begin
  select * into po from public.purchase_orders where id = p_id for update;
  if po.id is null then raise exception 'INVALID_PO: la orden no existe'; end if;
  if not public.has_perm(po.organization_id, 'purchases', 'create') then raise exception 'FORBIDDEN: tu rol no permite registrar recepciones'; end if;
  if po.status not in ('APPROVED', 'PARTIAL') then raise exception 'PO_STATE: solo se recibe una orden autorizada (estado actual: %)', po.status; end if;
  if not exists (select 1 from public.warehouses w where w.id = p_wh and w.organization_id = po.organization_id and w.is_active) then raise exception 'INVALID_WAREHOUSE: elegí el depósito donde entra la mercadería'; end if;
  insert into public.purchase_receipts(organization_id, po_id, supplier_id, warehouse_id, note) values (po.organization_id, p_id, po.supplier_id, p_wh, nullif(btrim(coalesce(p_note, '')), '')) returning id into rid;
  for it in select * from jsonb_array_elements(p_items) loop
    q := coalesce((it->>'qty')::numeric, 0); if q <= 0 then continue; end if;
    select * into poi from public.purchase_order_items i where i.id = (it->>'item_id')::uuid and i.po_id = p_id for update;
    if poi.id is null then raise exception 'INVALID_ITEM: una línea no pertenece a la orden'; end if;
    if q > poi.qty_ordered - poi.qty_received then raise exception 'OVER_RECEIPT: se intenta recibir más de lo pendiente de un producto'; end if;
    lot := nullif(btrim(coalesce(it->>'lot', '')), ''); if lot is null then raise exception 'LOT_REQUIRED: indicá el lote de cada producto recibido'; end if;
    exp := nullif(it->>'expires', '')::date;
    select coalesce(sum(ip.quantity), 0) into stock_before from public.inventory_positions ip where ip.organization_id = po.organization_id and ip.product_id = poi.product_id;
    perform public.stock_in(po.organization_id, p_wh, poi.product_id, lot, q, 'Recepción OC ' || po.number, 'RECEIPT', exp);
    select x.avg_cost into cur_avg from public.products x where x.id = poi.product_id;
    new_avg := case when stock_before <= 0 or cur_avg is null then poi.unit_price else round((stock_before * cur_avg + q * poi.unit_price) / (stock_before + q), 4) end;
    update public.products set avg_cost = new_avg where id = poi.product_id;
    insert into public.purchase_receipt_items(receipt_id, organization_id, po_item_id, product_id, lot_number, expiration_date, qty, unit_price) values (rid, po.organization_id, poi.id, poi.product_id, lot, exp, q, poi.unit_price);
    update public.purchase_order_items set qty_received = qty_received + q where id = poi.id;
    insert into public.purchase_prices(organization_id, supplier_id, product_id, unit_price, source, reference) values (po.organization_id, po.supplier_id, poi.product_id, poi.unit_price, 'RECEIPT', 'OC ' || po.number);
    got := true;
  end loop;
  if not got then raise exception 'EMPTY_RECEIPT: indicá al menos una cantidad recibida'; end if;
  select coalesce(sum(i.qty_ordered - i.qty_received), 0) into open_left from public.purchase_order_items i where i.po_id = p_id;
  update public.purchase_orders set status = case when open_left <= 0 then 'RECEIVED' else 'PARTIAL' end where id = p_id;
  return rid; end $$;

create function public.add_purchase_price(p_org uuid, p_supplier uuid, p_product uuid, p_price numeric, p_date date default current_date, p_ref text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid; begin
  if not public.has_perm(p_org, 'purchases', 'create') then raise exception 'FORBIDDEN: tu rol no permite cargar precios'; end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier and s.organization_id = p_org and s.is_active) then raise exception 'INVALID_SUPPLIER: el proveedor no existe'; end if;
  if not exists (select 1 from public.products x where x.id = p_product and x.organization_id = p_org and x.is_active) then raise exception 'INVALID_PRODUCT: el producto no existe'; end if;
  if p_price is null or p_price < 0 then raise exception 'INVALID_PRICE: el precio debe ser un número igual o mayor que cero'; end if;
  insert into public.purchase_prices(organization_id, supplier_id, product_id, unit_price, quoted_at, source, reference) values (p_org, p_supplier, p_product, p_price, coalesce(p_date, current_date), 'MANUAL', nullif(btrim(coalesce(p_ref, '')), '')) returning id into rid;
  return rid; end $$;

create function public.delete_supplier(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_perm(p_org, 'purchases', 'delete') then raise exception 'FORBIDDEN: tu rol no permite eliminar proveedores'; end if;
  if exists (select 1 from public.purchase_orders o where o.supplier_id = p_id and o.organization_id = p_org and o.status in ('DRAFT', 'APPROVED', 'PARTIAL')) then raise exception 'HAS_ORDERS: tiene órdenes de compra abiertas; resolvelas primero'; end if;
  update public.suppliers set is_active = false where id = p_id and organization_id = p_org;
  if not found then raise exception 'INVALID_SUPPLIER: el proveedor no existe'; end if; end $$;

-- Factura del proveedor vinculada a las recepciones que cubre (cada recepción solo puede tener una factura).
create function public.register_supplier_invoice(p_org uuid, p_supplier uuid, p_type text, p_pto int, p_number bigint, p_date date, p_due date, p_net numeric, p_iva numeric, p_total numeric, p_cae text, p_receipts uuid[], p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare iid uuid; r uuid; begin
  if not public.has_perm(p_org, 'purchases', 'create') then raise exception 'FORBIDDEN: tu rol no permite registrar facturas de proveedor'; end if;
  if not exists (select 1 from public.suppliers s where s.id = p_supplier and s.organization_id = p_org) then raise exception 'INVALID_SUPPLIER: el proveedor no existe'; end if;
  insert into public.supplier_invoices(organization_id, supplier_id, doc_type, pto_vta, number, invoice_date, due_date, total_net, total_iva, total, cae, notes)
    values (p_org, p_supplier, p_type, coalesce(p_pto, 0), p_number, p_date, p_due, p_net, coalesce(p_iva, 0), p_total, nullif(btrim(coalesce(p_cae, '')), ''), nullif(btrim(coalesce(p_notes, '')), '')) returning id into iid;
  if p_receipts is not null then
    foreach r in array p_receipts loop
      if not exists (select 1 from public.purchase_receipts x where x.id = r and x.organization_id = p_org and x.supplier_id = p_supplier) then raise exception 'INVALID_RECEIPT: una recepción no corresponde a este proveedor'; end if;
      insert into public.supplier_invoice_receipts(invoice_id, receipt_id) values (iid, r);
    end loop;
  end if;
  return iid; end $$;

create function public.set_supplier_invoice_paid(p_id uuid, p_paid boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare inv record; begin
  select * into inv from public.supplier_invoices where id = p_id;
  if inv.id is null then raise exception 'INVALID_INVOICE: la factura no existe'; end if;
  if not public.has_perm(inv.organization_id, 'purchases', 'approve') then raise exception 'FORBIDDEN: tu rol no permite marcar pagos'; end if;
  update public.supplier_invoices set status = case when p_paid then 'PAID' else 'PENDING' end, paid_at = case when p_paid then current_date else null end where id = p_id; end $$;

-- Precios que publican las empresas conectadas por el mismo producto (se vinculan por GTIN) para compararlos con los de tus proveedores.
create function public.network_prices(p_org uuid, p_product uuid) returns table(partner_id uuid, partner text, product text, unit_price numeric, available numeric)
language plpgsql stable security definer set search_path = '' as $$
declare g text; begin
  if not public.has_perm(p_org, 'purchases', 'view') then raise exception 'FORBIDDEN: tu rol no permite ver compras'; end if;
  select lpad(x.gtin, 14, '0') into g from public.products x where x.id = p_product and x.organization_id = p_org;
  if g is null then return; end if;
  return query select o.id, o.display_name, p.name, round(p.price / p.price_per, 4), so.qty
    from public.stock_offers so join public.products p on p.id = so.product_id join public.organizations o on o.id = so.organization_id
    where so.qty > 0 and p.price is not null and p.gtin is not null and lpad(p.gtin, 14, '0') = g and o.id <> p_org
      and exists (select 1 from public.business_relationships r where r.status = 'ACTIVE' and ((r.organization_a = o.id and r.organization_b = p_org) or (r.organization_b = o.id and r.organization_a = p_org)))
    order by 4; end $$;

-- =====================================================================
-- C) REPORTES (ventas a consumidores + movimientos con la red)
-- =====================================================================
-- Más y menos vendidos y margen: el ingreso por ventas a consumidores sale de las ventas reales (neto, sin IVA); el de lo enviado a empresas
-- conectadas se estima con el precio de lista actual. El costo es el costo promedio ponderado de las compras.
create function public.report_sales(p_org uuid, p_from date, p_to date) returns table(product_id uuid, name text, sku text, unit text, qty_consumer numeric, rev_consumer numeric, qty_network numeric, rev_network numeric, avg_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm(p_org, 'reports', 'view') then raise exception 'FORBIDDEN: tu rol no permite ver reportes'; end if;
  return query
  with cons as (select si.product_id as pid, sum(si.qty) as q, sum(si.qty * si.unit_price) as r from public.sale_items si join public.sales s on s.id = si.sale_id
                where si.organization_id = p_org and s.sale_date between p_from and p_to group by si.product_id),
       net as (select sh.product_id as pid, sum(sh.qty_shipped) as q from public.shipments sh
               where sh.from_org = p_org and sh.created_at >= p_from::timestamptz and sh.created_at < (p_to + 1)::timestamptz group by sh.product_id)
  select p.id, p.name, p.sku, p.unit, coalesce(c.q, 0), round(coalesce(c.r, 0), 2), coalesce(n.q, 0), round(coalesce(n.q, 0) / p.price_per * coalesce(p.price, 0), 2), p.avg_cost
  from public.products p left join cons c on c.pid = p.id left join net n on n.pid = p.id
  where p.organization_id = p_org and p.is_active and (c.pid is not null or n.pid is not null); end $$;

create function public.report_idle(p_org uuid, p_days int) returns table(product_id uuid, name text, sku text, unit text, stock numeric, last_move timestamptz, avg_cost numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm(p_org, 'reports', 'view') then raise exception 'FORBIDDEN: tu rol no permite ver reportes'; end if;
  return query
  select p.id, p.name, p.sku, p.unit, st.stock, lm.last_move, p.avg_cost
  from public.products p
  join (select ip.product_id as pid, sum(ip.quantity) as stock from public.inventory_positions ip where ip.organization_id = p_org group by ip.product_id having sum(ip.quantity) > 0) st on st.pid = p.id
  left join (select e.product_id as pid, max(e.occurred_at) as last_move from public.inventory_events e where e.organization_id = p_org and e.event_type in ('SALE', 'SHIPMENT', 'PRODUCTION_INPUT') group by e.product_id) lm on lm.pid = p.id
  where p.organization_id = p_org and p.is_active and (lm.last_move is null or lm.last_move < now() - make_interval(days => p_days))
  order by lm.last_move nulls first; end $$;

-- Comercio con cada empresa conectada: valor estimado a precio de lista de lo enviado y lo recibido.
create function public.report_network(p_org uuid, p_from date, p_to date) returns table(partner_id uuid, partner text, sent_value numeric, received_value numeric, shipments integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_perm(p_org, 'reports', 'view') then raise exception 'FORBIDDEN: tu rol no permite ver reportes'; end if;
  return query
  with sent as (select s.to_org as pid, sum(s.qty_shipped / p.price_per * coalesce(p.price, 0)) as v, count(*) as n from public.shipments s join public.products p on p.id = s.product_id
                where s.from_org = p_org and s.created_at >= p_from::timestamptz and s.created_at < (p_to + 1)::timestamptz group by s.to_org),
       recv as (select s.from_org as pid, sum(coalesce(s.qty_received, s.qty_shipped) / p.price_per * coalesce(p.price, 0)) as v, count(*) as n from public.shipments s join public.products p on p.id = s.product_id
                where s.to_org = p_org and s.created_at >= p_from::timestamptz and s.created_at < (p_to + 1)::timestamptz group by s.from_org)
  select o.id, o.display_name, round(coalesce(se.v, 0), 2), round(coalesce(re.v, 0), 2), (coalesce(se.n, 0) + coalesce(re.n, 0))::integer
  from public.organizations o left join sent se on se.pid = o.id left join recv re on re.pid = o.id
  where se.pid is not null or re.pid is not null order by 3 desc; end $$;

-- =====================================================================
-- Permisos de ejecución
-- =====================================================================
revoke all on function public.has_perm, public.role_key_of, public.default_perm, public.list_team, public.invite_member, public.claim_member_invites, public.set_member_role, public.remove_member, public.cancel_invite, public.set_role_perms,
  public.create_purchase_order, public.approve_purchase_order, public.cancel_purchase_order, public.receive_purchase_order, public.add_purchase_price, public.delete_supplier, public.register_supplier_invoice,
  public.set_supplier_invoice_paid, public.network_prices, public.report_sales, public.report_idle, public.report_network from public, anon;
grant execute on function public.has_perm, public.role_key_of, public.default_perm, public.list_team, public.invite_member, public.claim_member_invites, public.set_member_role, public.remove_member, public.cancel_invite, public.set_role_perms,
  public.create_purchase_order, public.approve_purchase_order, public.cancel_purchase_order, public.receive_purchase_order, public.add_purchase_price, public.delete_supplier, public.register_supplier_invoice,
  public.set_supplier_invoice_paid, public.network_prices, public.report_sales, public.report_idle, public.report_network to authenticated;
notify pgrst, 'reload schema';
