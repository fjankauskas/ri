-- 0007: Clientes, ventas (con descuento de stock) y facturación electrónica ARCA.
-- Cada empresa factura con su propio CUIT, punto de venta y certificado. Ejecutar DESPUÉS de 0006. No borra datos.

-- IVA por producto (el precio de venta es neto, sin IVA)
alter table products add column iva text not null default '21' check (iva in ('0','2.5','5','10.5','21','27','EX','NG'));

-- ---------- Clientes ----------
create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  name text not null,
  doc_type int not null default 99 check (doc_type in (80, 86, 96, 99)),         -- 80 CUIT · 86 CUIL · 96 DNI · 99 sin identificar
  doc_number text not null default '0',
  iva_condition int not null default 5 check (iva_condition in (1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16)),  -- códigos de FEParamGetCondicionIvaReceptor
  email text, phone text, address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (doc_type <> 99 or doc_number = '0'));
create unique index customers_doc_idx on customers (organization_id, doc_type, doc_number) where doc_type <> 99 and is_active;
alter table customers enable row level security;
create policy cust_read on customers for select to authenticated using (private.is_member(organization_id));
create policy cust_write on customers for all to authenticated
  using (private.is_member(organization_id, array['OWNER','ADMIN','SALES']::org_role[]))
  with check (private.is_member(organization_id, array['OWNER','ADMIN','SALES']::org_role[]));

-- ---------- Ventas ----------
create table sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  customer_id uuid references customers,                                          -- sin cliente = consumidor final
  warehouse_id uuid not null references warehouses,
  sale_date date not null default current_date,
  payment_method text, notes text,
  invoice_state text not null default 'NONE' check (invoice_state in ('NONE', 'PROCESSING', 'INVOICED')),
  processing_at timestamptz, invoice_error text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now());
create index sales_org_idx on sales (organization_id, created_at desc);
create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  product_id uuid not null references products,
  description text not null,
  qty numeric(18,4) not null check (qty > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),                      -- neto, sin IVA
  iva text not null check (iva in ('0','2.5','5','10.5','21','27','EX','NG')));
create index sale_items_sale_idx on sale_items (sale_id);
alter table sales enable row level security;
alter table sale_items enable row level security;
create policy sales_read on sales for select to authenticated using (private.is_member(organization_id));
create policy sale_items_read on sale_items for select to authenticated using (private.is_member(organization_id));

-- ---------- ARCA: datos fiscales, credenciales por ambiente, tickets y comprobantes ----------
create table arca_profile (
  organization_id uuid primary key references organizations on delete cascade,
  cuit text not null, legal_name text not null,
  iva_condition text not null check (iva_condition in ('RI', 'MONO', 'EXENTO')),
  address text, gross_income text, activity_start date,
  active_env text not null default 'homologacion' check (active_env in ('homologacion', 'produccion')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now());
create table arca_accounts (
  organization_id uuid not null references organizations on delete cascade,
  environment text not null check (environment in ('homologacion', 'produccion')),
  punto_venta int check (punto_venta between 1 and 99998),
  csr_pem text, cert_pem text, cert_valid_to timestamptz,
  last_test_at timestamptz, last_test_ok boolean, last_test_message text,
  primary key (organization_id, environment));
create table arca_keys (            -- clave privada CIFRADA con ARCA_ENCRYPTION_KEY; ningún usuario puede leerla
  organization_id uuid not null references organizations on delete cascade,
  environment text not null check (environment in ('homologacion', 'produccion')),
  key_encrypted text not null, created_at timestamptz not null default now(),
  primary key (organization_id, environment));
create table arca_tokens (          -- ticket de acceso del WSAA (token + sign, ~12 h); solo el servidor lo usa
  organization_id uuid not null references organizations on delete cascade,
  environment text not null check (environment in ('homologacion', 'produccion')),
  service text not null, token text not null, sign text not null, expires_at timestamptz not null,
  primary key (organization_id, environment, service));
create table arca_log (
  id bigserial primary key,
  organization_id uuid not null references organizations on delete cascade,
  environment text, action text not null, ok boolean not null, request jsonb, response jsonb, error text,
  created_at timestamptz not null default now());
create index arca_log_org_idx on arca_log (organization_id, created_at desc);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  sale_id uuid not null references sales,
  kind text not null check (kind in ('INVOICE', 'CREDIT_NOTE')),
  related_invoice_id uuid references invoices,
  environment text not null check (environment in ('homologacion', 'produccion')),
  cbte_tipo int not null, pto_vta int not null, cbte_nro bigint not null, cbte_fch date not null,
  doc_tipo int not null, doc_nro text not null, receptor_nombre text not null, receptor_iva int not null,
  imp_total numeric(15,2) not null, imp_neto numeric(15,2) not null, imp_iva numeric(15,2) not null,
  imp_tot_conc numeric(15,2) not null default 0, imp_op_ex numeric(15,2) not null default 0,
  alic jsonb not null default '[]', items jsonb not null default '[]',
  cae text not null, cae_vto date not null, observaciones jsonb not null default '[]', qr_url text not null,
  emisor jsonb not null,            -- foto de los datos del emisor al emitir, para reimprimir igual que salió
  credit_lock_at timestamptz,       -- candado para no emitir dos notas de crédito a la vez
  created_by uuid, created_at timestamptz not null default now(),
  unique (organization_id, environment, pto_vta, cbte_tipo, cbte_nro));
create unique index invoices_one_per_sale on invoices (sale_id, environment) where kind = 'INVOICE';
create unique index invoices_one_credit on invoices (related_invoice_id) where kind = 'CREDIT_NOTE';
create index invoices_org_idx on invoices (organization_id, created_at desc);

alter table arca_profile enable row level security;
alter table arca_accounts enable row level security;
alter table arca_keys enable row level security;
alter table arca_tokens enable row level security;
alter table arca_log enable row level security;
alter table invoices enable row level security;
create policy arca_profile_read on arca_profile for select to authenticated using (private.is_member(organization_id));
create policy arca_accounts_read on arca_accounts for select to authenticated using (private.is_member(organization_id));
create policy invoices_read on invoices for select to authenticated using (private.is_member(organization_id));
create policy arca_log_read on arca_log for select to authenticated using (private.is_member(organization_id, array['OWNER','ADMIN']::org_role[]));

-- Escrituras: solo por funciones o por el servidor (service role) tras verificar el rol del usuario
revoke insert, update, delete on sales, sale_items, arca_profile, arca_accounts, arca_log, invoices from anon, authenticated;
revoke all on arca_keys, arca_tokens from anon, authenticated;
grant select, insert, update, delete on customers, sales, sale_items, arca_profile, arca_accounts, arca_keys, arca_tokens, arca_log, invoices to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------- Registrar una venta: descuenta el stock del depósito (primero lo que vence antes) en una sola transacción ----------
-- p_items: [{"product_id":"…","qty":2,"unit_price":100.5,"iva":"21","description":"opcional"}]
create function public.create_sale(p_org uuid, p_customer uuid, p_wh uuid, p_items jsonb, p_payment text default null, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid; it jsonb; prod record; a record; need numeric; take numeric; legs jsonb := '[]'::jsonb; ivak text; price numeric; begin
  if not private.is_member(p_org, array['OWNER','ADMIN','SALES']::public.org_role[]) then raise exception 'FORBIDDEN: no tenés permiso para registrar ventas'; end if;
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

revoke all on function public.create_sale from public, anon;
grant execute on function public.create_sale to authenticated;
notify pgrst, 'reload schema';
