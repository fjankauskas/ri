"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/ctx";
import { mustCan } from "@/lib/perms-server";
import { validateGtin } from "@/lib/gs1/check";
import { gtinTaken } from "@/lib/gs1/data";
import { lookupOff } from "@/lib/off/service";
import { offStatusText } from "@/lib/off/messages";
import { parseQuantity, suggestedName } from "@/lib/off/normalize";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (f: FormData, def: string) => (/^\/gs1(\?[\w=&%.|\-]*)?$/.test(s(f, "back")) ? s(f, "back") : def);
const withParam = (path: string, k: string, v: string) => `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
type Result = void | { path?: string; ok?: string };
async function run(path: string, fn: () => Promise<Result>, ok: string, perm?: string[]) {
  let err = "", out: Result = undefined;
  try { if (perm) await mustCan(perm[0], perm[1]); out = await fn(); } catch (e: any) { err = String(e?.message ?? "Error inesperado").replace(/^[A-Z_]+: /, ""); }
  revalidatePath("/", "layout");
  const to = (out && out.path) || path;
  redirect(err ? withParam(to, "e", err) : withParam(to, "ok", (out && out.ok) || ok));
}
const firstBrand = (b: string | null) => (b ?? "").split(",")[0].trim() || null;

/** Crea un producto de tu empresa con los datos de Open Food Facts (nombre, marca y cantidad), dejando registrada la procedencia. */
export async function createProductFromOff(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, "/gs1?v=products"), async () => {
    const g = s(f, "gtin").replace(/[\s-]/g, ""), v = validateGtin(g); if (!v.ok) throw new Error(v.error);
    if (await gtinTaken(sb, org.id, g)) throw new Error("Ya tenés un producto con ese GTIN.");
    const r = await lookupOff(g); if (r.status !== "local" && r.status !== "found") throw new Error(offStatusText(r) ?? "No se pudo obtener el producto.");
    const p = r.product, q = parseQuantity(p.quantity);
    const { data: dup } = await sb.from("products").select("id").eq("organization_id", org.id).ilike("sku", g).limit(1);
    if (dup?.length) throw new Error("Ya existe un producto con ese código interno.");
    const { data, error } = await sb.from("products").insert({ organization_id: org.id, sku: g, name: suggestedName(p) || `Producto ${g}`, unit: q?.unit ?? "u", gtin: g, min_stock: 0, iva: "21" }).select("id").single();
    if (error) throw new Error(error.code === "23505" ? "Ya existe un producto con ese código o GTIN." : error.message);
    await sb.from("product_gs1").upsert({ product_id: data.id, organization_id: org.id, brand: firstBrand(p.brands), ...(q ? { net_content: q.value, net_content_uom: q.uom } : {}), data_source: "off", data_source_at: new Date().toISOString() });
    return { path: `/gs1?v=products&id=${data.id}`, ok: "Producto creado con datos de Open Food Facts (nombre, marca y cantidad). Revisá el IVA y el precio en Inventario." };
  }, "Producto creado", ["inventory", "create"]);
}
/** Completa marca y contenido neto de un producto tuyo con lo que informa Open Food Facts (solo si están vacíos). */
export async function fillFromOff(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, "/gs1?v=products"), async () => {
    const { data: p } = await sb.from("products").select("id, gtin").eq("id", s(f, "product")).eq("organization_id", org.id).maybeSingle();
    if (!p?.gtin) throw new Error("El producto no tiene GTIN.");
    const r = await lookupOff(p.gtin); if (r.status !== "local" && r.status !== "found") throw new Error(offStatusText(r) ?? "No se pudo obtener el producto.");
    const { data: cur } = await sb.from("product_gs1").select("brand, net_content, net_content_uom, data_source").eq("product_id", p.id).maybeSingle();
    const q = parseQuantity(r.product.quantity), next: Record<string, unknown> = {}, changed: string[] = [];
    if (!cur?.brand && firstBrand(r.product.brands)) { next.brand = firstBrand(r.product.brands); changed.push("marca"); }
    if (cur?.net_content == null && q) { next.net_content = q.value; next.net_content_uom = q.uom; changed.push("contenido neto"); }
    if (changed.length) { const { error } = await sb.from("product_gs1").upsert({ product_id: p.id, organization_id: org.id, ...next, data_source: cur?.data_source ?? "off", data_source_at: new Date().toISOString() }); if (error) throw new Error(error.message); }
    return { ok: changed.length ? `Se completó: ${changed.join(" y ")} (datos de Open Food Facts).` : "La ficha ya tenía la marca y el contenido neto." };
  }, "Ficha completada", ["gs1", "edit"]);
}
