"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/ctx";
import { isValidCuit } from "@/lib/arca/cuit";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (x: string) => (x === "" ? null : Number(x.replace(",", ".")));
const PATH = { orders: "/purchases?v=orders", suppliers: "/purchases?v=suppliers", invoices: "/purchases?v=invoices", prices: "/purchases?v=prices" };
const back = (f: FormData, def: string) => (/^\/purchases(\?[\w=&%.|\-]*)?$/.test(s(f, "back")) ? s(f, "back") : def);
const withParam = (path: string, k: string, v: string) => `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
const clean = (e: any) => String(e?.message ?? "Error inesperado").replace(/^[A-Z_]+: /, "");
type Result = void | { path?: string; ok?: string };
async function run(path: string, fn: () => Promise<Result>, ok: string) {
  let err = "", out: Result = undefined;
  try { out = await fn(); } catch (e: any) { err = clean(e); }
  revalidatePath("/", "layout");
  const to = (out && out.path) || path;
  redirect(err ? withParam(to, "e", err) : withParam(to, "ok", (out && out.ok) || ok));
}
const rpc = async (sb: any, fn: string, args: Record<string, unknown>) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; };

// ---------- Proveedores ----------
export async function saveSupplier(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.suppliers), async () => {
    const id = s(f, "id"), name = s(f, "name"), cuit = s(f, "cuit").replace(/\D/g, "");
    if (!name) throw new Error("Indicá el nombre o la razón social del proveedor.");
    if (cuit && !isValidCuit(cuit)) throw new Error("El CUIT no es válido (11 dígitos con dígito verificador).");
    const int = (k: string) => { const v = num(s(f, k)); if (v !== null && (!Number.isInteger(v) || v < 0)) throw new Error("Los plazos deben ser días enteros (0 o más)."); return v; };
    const minOrder = num(s(f, "min_order")); if (minOrder !== null && !(minOrder >= 0)) throw new Error("El pedido mínimo debe ser un número igual o mayor que cero.");
    const row = { name, cuit: cuit || null, contact_name: s(f, "contact_name") || null, email: s(f, "email") || null, phone: s(f, "phone") || null, address: s(f, "address") || null, payment_days: int("payment_days") ?? 0, delivery_days: int("delivery_days"), min_order: minOrder, terms: s(f, "terms") || null, linked_org_id: s(f, "linked_org") || null };
    const q = id ? sb.from("suppliers").update(row).eq("id", id).eq("organization_id", org.id) : sb.from("suppliers").insert({ ...row, organization_id: org.id });
    const { error } = await q;
    if (error) throw new Error(error.code === "23505" ? "Ya tenés un proveedor con ese CUIT." : /row-level security/i.test(error.message) ? "Tu rol no permite esta acción en «Compras y proveedores»." : error.message);
  }, s(f, "id") ? "Proveedor actualizado" : "Proveedor creado");
}
export async function deleteSupplier(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.suppliers), async () => { await rpc(sb, "delete_supplier", { p_org: org.id, p_id: s(f, "id") }); }, "Proveedor eliminado (su historial se conserva)");
}

// ---------- Órdenes de compra ----------
export async function createPo(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.orders), async () => {
    const prod = f.getAll("item_product").map(String), qty = f.getAll("item_qty").map(String), price = f.getAll("item_price").map(String), iva = f.getAll("item_iva").map(String);
    const items = prod.map((p, i) => ({ product_id: p, qty: num(qty[i] ?? ""), unit_price: num(price[i] ?? ""), iva: iva[i] || null })).filter((i) => i.product_id);
    if (!s(f, "supplier")) throw new Error("Elegí el proveedor.");
    if (!items.length) throw new Error("Agregá al menos un producto a la orden.");
    if (items.some((i) => !(Number(i.qty) > 0))) throw new Error("Todas las cantidades deben ser mayores que cero.");
    const id = await rpc(sb, "create_purchase_order", { p_org: org.id, p_supplier: s(f, "supplier"), p_items: items, p_expected: s(f, "expected") || null, p_notes: s(f, "notes") || null });
    return { path: withParam(PATH.orders, "po", String(id)), ok: "Orden de compra creada en borrador. Una persona con permiso de autorizar debe aprobarla antes de recibir mercadería." };
  }, "Orden creada");
}
export async function approvePo(f: FormData) { const { sb } = await ctx(); await run(back(f, PATH.orders), async () => { await rpc(sb, "approve_purchase_order", { p_id: s(f, "po") }); }, "Orden autorizada: ya se puede recibir la mercadería"); }
export async function cancelPo(f: FormData) { const { sb } = await ctx(); await run(back(f, PATH.orders), async () => { await rpc(sb, "cancel_purchase_order", { p_id: s(f, "po") }); }, "Orden cancelada"); }
export async function receivePo(f: FormData) {
  const { sb } = await ctx();
  await run(back(f, PATH.orders), async () => {
    const ids = f.getAll("rc_item").map(String), qty = f.getAll("rc_qty").map(String), lot = f.getAll("rc_lot").map(String), exp = f.getAll("rc_exp").map(String);
    const items = ids.map((id, i) => ({ item_id: id, qty: num(qty[i] ?? "") ?? 0, lot: (lot[i] ?? "").trim(), expires: exp[i] || null })).filter((i) => i.qty > 0);
    if (!items.length) throw new Error("Indicá al menos una cantidad recibida.");
    if (!s(f, "warehouse")) throw new Error("Elegí el depósito donde entra la mercadería.");
    await rpc(sb, "receive_purchase_order", { p_id: s(f, "po"), p_wh: s(f, "warehouse"), p_items: items, p_note: s(f, "note") || null });
  }, "Recepción registrada: el stock ya está disponible y el costo promedio se actualizó");
}

// ---------- Precios y facturas ----------
export async function addPrice(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.prices), async () => {
    const price = num(s(f, "price")); if (price === null || !(price >= 0)) throw new Error("Ingresá el precio (neto por unidad).");
    await rpc(sb, "add_purchase_price", { p_org: org.id, p_supplier: s(f, "supplier"), p_product: s(f, "product"), p_price: price, p_date: s(f, "date") || null, p_ref: s(f, "ref") || null });
  }, "Precio cargado en el historial");
}
export async function registerInvoice(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.invoices), async () => {
    const net = num(s(f, "total_net")), iva = num(s(f, "total_iva")) ?? 0, total = num(s(f, "total")), number = num(s(f, "number"));
    if (!s(f, "supplier")) throw new Error("Elegí el proveedor.");
    if (!number || !Number.isInteger(number) || number <= 0) throw new Error("Ingresá el número de la factura.");
    if (net === null || total === null || net < 0 || total < 0) throw new Error("Ingresá el neto y el total de la factura.");
    if (Math.abs(net + iva - total) > 0.05) throw new Error("El total no coincide con neto + IVA. Revisá los importes.");
    if (!s(f, "invoice_date")) throw new Error("Ingresá la fecha de la factura.");
    const { error } = await sb.rpc("register_supplier_invoice", { p_org: org.id, p_supplier: s(f, "supplier"), p_type: s(f, "doc_type") || "A", p_pto: num(s(f, "pto_vta")) ?? 0, p_number: number, p_date: s(f, "invoice_date"), p_due: s(f, "due_date") || null, p_net: net, p_iva: iva, p_total: total, p_cae: s(f, "cae") || null, p_receipts: f.getAll("receipt").map(String), p_notes: s(f, "notes") || null });
    if (error) throw new Error(/supplier_invoices_organization_id/.test(error.message) ? "Esa factura ya está cargada para ese proveedor." : /supplier_invoice_receipts_receipt_id/.test(error.message) ? "Una de las recepciones ya tiene una factura vinculada." : error.message);
  }, "Factura de proveedor registrada y vinculada a las recepciones");
}
export async function payInvoice(f: FormData) { const { sb } = await ctx(); await run(back(f, PATH.invoices), async () => { await rpc(sb, "set_supplier_invoice_paid", { p_id: s(f, "id"), p_paid: s(f, "paid") === "1" }); }, s(f, "paid") === "1" ? "Factura marcada como pagada" : "Factura marcada como pendiente"); }
