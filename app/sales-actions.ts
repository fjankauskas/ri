"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/ctx";
import { isValidCuit } from "@/lib/arca/cuit";
import { hasEncryptionKey } from "@/lib/arca/crypto";
import { hasServiceKey } from "@/lib/supabase/admin";
import * as arca from "@/lib/arca/service";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (x: string) => Number(x.replace(",", "."));
const PATH = { sales: "/sales?v=sales", customers: "/sales?v=customers", invoices: "/sales?v=invoices", arca: "/sales?v=arca" };
// Solo se vuelve a rutas propias de Ventas con parámetros simples.
const back = (f: FormData, def: string) => (/^\/sales(\?[\w=&%.|\-]*)?$/.test(s(f, "back")) ? s(f, "back") : def);
const SELL = ["OWNER", "ADMIN", "SALES"], ADMIN = ["OWNER", "ADMIN"];
function need(role: string, roles: string[], what: string) { if (!roles.includes(role)) throw new Error(`Tu rol no permite ${what}.`); }
const withParam = (path: string, k: string, v: string) => `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;

type Result = void | { path?: string; ok?: string };
async function run(path: string, fn: () => Promise<Result>, ok: string) {
  let err = "", out: Result = undefined;
  try { out = await fn(); } catch (e: any) { err = e?.message ?? "Error inesperado"; }
  revalidatePath("/", "layout");
  const to = (out && out.path) || path;
  redirect(err ? withParam(to, "e", err) : withParam(to, "ok", (out && out.ok) || ok));
}
function needServer() {
  if (!hasServiceKey()) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local (clave «service_role» o «secret» de Supabase). Ver ARCA-SETUP.md.");
  if (!hasEncryptionKey()) throw new Error("Falta ARCA_ENCRYPTION_KEY en .env.local (32 bytes en base64). Ver ARCA-SETUP.md.");
}
const readFile = async (f: FormData, name: string) => { const x = f.get(name); return x instanceof File && x.size > 0 ? (await x.text()).trim() : ""; };

// ---------- Clientes ----------
export async function saveCustomer(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.customers), async () => {
    need(role, SELL, "gestionar clientes");
    const id = s(f, "id"), name = s(f, "name"), docType = Number(s(f, "doc_type")), iva = Number(s(f, "iva_condition"));
    let doc = docType === 99 ? "0" : s(f, "doc_number").replace(/\D/g, "");
    if (!name) throw new Error("Indicá el nombre o la razón social del cliente.");
    if ((docType === 80 || docType === 86) && !isValidCuit(doc)) throw new Error("El CUIT/CUIL no es válido (11 dígitos con dígito verificador).");
    if (docType === 96 && !/^\d{7,8}$/.test(doc)) throw new Error("El DNI debe tener 7 u 8 dígitos.");
    if (docType === 99) doc = "0";
    const row = { name, doc_type: docType, doc_number: doc, iva_condition: iva, email: s(f, "email") || null, phone: s(f, "phone") || null, address: s(f, "address") || null };
    const q = id ? sb.from("customers").update(row).eq("id", id).eq("organization_id", org.id) : sb.from("customers").insert({ ...row, organization_id: org.id });
    const { error } = await q;
    if (error) throw new Error(error.code === "23505" ? "Ya existe un cliente con ese documento." : error.message);
  }, s(f, "id") ? "Cliente actualizado" : "Cliente creado");
}
export async function deleteCustomer(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.customers), async () => {
    need(role, SELL, "eliminar clientes");
    const { error } = await sb.from("customers").update({ is_active: false }).eq("id", s(f, "id")).eq("organization_id", org.id);
    if (error) throw new Error(error.message);
  }, "Cliente eliminado (sus ventas anteriores se conservan)");
}

// ---------- Ventas ----------
export async function createSale(f: FormData) {
  const { sb, org, role, user } = await ctx();
  await run(back(f, PATH.sales), async () => {
    need(role, SELL, "registrar ventas");
    const prod = f.getAll("item_product").map(String), qty = f.getAll("item_qty").map(String), price = f.getAll("item_price").map(String), iva = f.getAll("item_iva").map(String);
    const items = prod.map((p, i) => ({ product_id: p, qty: num(qty[i] ?? ""), unit_price: num(price[i] ?? ""), iva: iva[i] ?? "" })).filter((i) => i.product_id);
    if (!items.length) throw new Error("Agregá al menos un producto a la venta.");
    if (items.some((i) => !(i.qty > 0))) throw new Error("Todas las cantidades deben ser mayores que cero.");
    if (items.some((i) => !(i.unit_price >= 0))) throw new Error("Revisá los precios: deben ser números iguales o mayores que cero.");
    const { data: id, error } = await sb.rpc("create_sale", { p_org: org.id, p_customer: s(f, "customer") || null, p_wh: s(f, "warehouse"), p_items: items, p_payment: s(f, "payment") || null, p_notes: s(f, "notes") || null });
    if (error) throw new Error(error.message.replace(/^[A-Z_]+: /, ""));
    const here = withParam(PATH.sales, "sale", String(id));
    if (!f.get("invoice_now")) return { path: here, ok: "Venta registrada y stock descontado" };
    try {
      need(role, SELL, "emitir facturas"); needServer();
      await arca.invoiceSale(org.id, String(id), user.id);
      return { path: here, ok: "Venta registrada, stock descontado y factura emitida" };
    } catch (e: any) { return { path: withParam(here, "e", `La venta se registró y el stock se descontó, pero la factura no se emitió: ${e.message}`) }; }
  }, "Venta registrada");
}
export async function invoiceSale(f: FormData) {
  const { org, role, user } = await ctx();
  await run(back(f, PATH.sales), async () => { need(role, SELL, "emitir facturas"); needServer(); await arca.invoiceSale(org.id, s(f, "sale"), user.id); }, "Factura emitida y autorizada por ARCA");
}
export async function creditNote(f: FormData) {
  const { org, role, user } = await ctx();
  await run(back(f, PATH.invoices), async () => {
    need(role, SELL, "emitir notas de crédito"); needServer();
    if (!f.get("confirm")) throw new Error("Marcá «Confirmo que quiero anular esta factura» para continuar.");
    await arca.issueCreditNote(org.id, s(f, "invoice"), user.id);
  }, "Nota de crédito emitida: la factura quedó anulada. Si devolvieron mercadería, reingresá el stock desde Inventario");
}

// ---------- Configuración de ARCA (solo dueños y administradores) ----------
export async function saveArcaProfile(f: FormData) {
  const { org, role } = await ctx();
  await run(back(f, PATH.arca), async () => {
    need(role, ADMIN, "cambiar la configuración fiscal"); needServer();
    const note = await arca.saveProfile(org.id, { cuit: s(f, "cuit"), legal_name: s(f, "legal_name"), iva_condition: s(f, "iva_condition"), address: s(f, "address"), gross_income: s(f, "gross_income"), activity_start: s(f, "activity_start"), active_env: s(f, "active_env") || "homologacion", enabled: !!f.get("enabled") });
    return { ok: `Datos fiscales guardados.${note}` };
  }, "Datos fiscales guardados");
}
export async function saveArcaPv(f: FormData) {
  const { org, role } = await ctx();
  await run(back(f, PATH.arca), async () => { need(role, ADMIN, "cambiar la configuración fiscal"); needServer(); await arca.savePuntoVenta(org.id, s(f, "env"), num(s(f, "punto_venta"))); }, "Punto de venta guardado");
}
export async function generateCsr(f: FormData) {
  const { org, role } = await ctx();
  await run(back(f, PATH.arca), async () => { need(role, ADMIN, "generar certificados"); needServer(); await arca.createCsr(org.id, s(f, "env")); }, "Clave y solicitud (CSR) generadas. Copiá la solicitud y subila a ARCA");
}
export async function uploadCert(f: FormData) {
  const { org, role } = await ctx();
  await run(back(f, PATH.arca), async () => {
    need(role, ADMIN, "cargar certificados"); needServer();
    const pem = (await readFile(f, "cert_file")) || s(f, "cert");
    if (!pem) throw new Error("Pegá el certificado (.crt) o elegí el archivo.");
    await arca.saveCertificate(org.id, s(f, "env"), pem);
  }, "Certificado guardado. Ahora probá la conexión");
}
export async function importCreds(f: FormData) {
  const { org, role } = await ctx();
  await run(back(f, PATH.arca), async () => {
    need(role, ADMIN, "cargar certificados"); needServer();
    const key = (await readFile(f, "key_file")) || s(f, "key"), cert = (await readFile(f, "cert_file")) || s(f, "cert");
    if (!key || !cert) throw new Error("Hacen falta la clave privada (.key) y el certificado (.crt).");
    await arca.importCredentials(org.id, s(f, "env"), key, cert);
  }, "Clave y certificado importados. Ahora probá la conexión");
}
export async function testArca(f: FormData) {
  const { org, role } = await ctx();
  await run(back(f, PATH.arca), async () => {
    need(role, ADMIN, "probar la conexión con ARCA"); needServer();
    const r = await arca.testConnection(org.id, s(f, "env"));
    if (!r.ok) throw new Error(r.message);
    return { ok: r.message };
  }, "Conexión correcta");
}
