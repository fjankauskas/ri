"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/ctx";
import { validateGtin, toGtin14, validateKey } from "@/lib/gs1/check";
import { gtin14 as buildGtin14, gln as buildGln, sscc as buildSscc } from "@/lib/gs1/keys";
import { allocateGtin, getSettings, gtinTaken } from "@/lib/gs1/data";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (x: string) => (x === "" ? null : Number(x.replace(",", ".")));
const PATH = { config: "/gs1?v=config", products: "/gs1?v=products", locations: "/gs1?v=locations" };
const back = (f: FormData, def: string) => (/^\/gs1(\?[\w=&%.|\-]*)?$/.test(s(f, "back")) ? s(f, "back") : def);
const withParam = (path: string, k: string, v: string) => `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
const STOCK = ["OWNER", "ADMIN", "INVENTORY_MANAGER"], ADMIN = ["OWNER", "ADMIN"], SHIP = ["OWNER", "ADMIN", "INVENTORY_MANAGER", "SALES"];
function need(role: string, roles: string[], what: string) { if (!roles.includes(role)) throw new Error(`Tu rol no permite ${what}.`); }
const clean = (e: any) => String(e?.message ?? "Error inesperado").replace(/^[A-Z_]+: /, "");
type Result = void | { ok?: string };
async function run(path: string, fn: () => Promise<Result>, ok: string) {
  let err = "", out: Result = undefined;
  try { out = await fn(); } catch (e: any) { err = clean(e); }
  revalidatePath("/", "layout");
  redirect(err ? withParam(path, "e", err) : withParam(path, "ok", (out && out.ok) || ok));
}
const dbError = (e: { code?: string; message: string }) => (e.code === "23505" ? "Ese GTIN ya está en uso en tu empresa." : e.message);

// ---------- Configuración ----------
export async function saveGs1Settings(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.config), async () => {
    need(role, ADMIN, "cambiar la configuración GS1");
    const prefix = s(f, "company_prefix").replace(/\D/g, "");
    if (prefix && (prefix.length < 6 || prefix.length > 12)) throw new Error("El prefijo de empresa GS1 tiene entre 6 y 12 dígitos.");
    let gln = s(f, "gln").replace(/\D/g, "");
    if (!gln && f.get("gen_gln") && prefix) { const { data: n, error } = await sb.rpc("gs1_next", { p_org: org.id, p_kind: "GLN" }); if (error) throw new Error(error.message); gln = buildGln(prefix, Number(n)); }
    if (gln) { const v = validateKey("GLN", gln); if (!v.ok) throw new Error(`GLN: ${v.error}`); }
    const { error } = await sb.from("gs1_settings").upsert({ organization_id: org.id, company_prefix: prefix || null, gln: gln || null, public_enabled: !!f.get("public_enabled"), updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }, "Configuración GS1 guardada");
}

// ---------- GTIN ----------
async function setGtin(sb: any, orgId: string, productId: string, gtin: string | null) {
  const { error } = await sb.from("products").update({ gtin }).eq("id", productId).eq("organization_id", orgId);
  if (error) throw new Error(dbError(error));
}
export async function assignGtin(f: FormData) {
  const { sb, org, role } = await ctx(); let msg = "GTIN asignado";
  await run(back(f, PATH.products), async () => {
    need(role, STOCK, "asignar GTIN");
    const id = s(f, "product"), { data: p } = await sb.from("products").select("id, gtin").eq("id", id).eq("organization_id", org.id).maybeSingle();
    if (!p) throw new Error("El producto no existe.");
    if (p.gtin && !f.get("replace")) throw new Error("Este producto ya tiene GTIN. Marcá «Reemplazar» si querés cambiarlo (los códigos impresos dejarían de servir).");
    const g = await allocateGtin(sb, org.id, s(f, "mode") === "internal" ? "internal" : "gs1");
    await setGtin(sb, org.id, id, g); msg = `GTIN asignado: ${g}`;
    return { ok: msg };
  }, msg);
}
/** Asigna GTIN a todos los productos activos que todavía no tienen. */
export async function assignAllGtins(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.products), async () => {
    need(role, STOCK, "asignar GTIN");
    if (!f.get("confirm")) throw new Error("Marcá la confirmación para asignar GTIN a todos los productos sin código.");
    const { data } = await sb.from("products").select("id").eq("organization_id", org.id).eq("is_active", true).is("gtin", null).limit(500);
    const mode = s(f, "mode") === "internal" ? "internal" : "gs1", list = (data as any[]) ?? [];
    if (!list.length) throw new Error("No hay productos sin GTIN.");
    for (const p of list) await setGtin(sb, org.id, p.id, await allocateGtin(sb, org.id, mode));
    return { ok: `Se asignó GTIN a ${list.length} producto(s)` };
  }, "GTIN asignados");
}
export async function saveProductGtin(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.products), async () => {
    need(role, STOCK, "cambiar el GTIN");
    const id = s(f, "product"), raw = s(f, "gtin").replace(/[\s-]/g, "");
    if (!raw) { await setGtin(sb, org.id, id, null); return { ok: "GTIN quitado" }; }
    const v = validateGtin(raw); if (!v.ok) throw new Error(v.error);
    if (await gtinTaken(sb, org.id, raw, id)) throw new Error("Ese GTIN ya lo usa otro producto de tu empresa.");
    await setGtin(sb, org.id, id, raw); return { ok: `GTIN guardado (${v.kind})` };
  }, "GTIN guardado");
}
const LEVELS: Record<string, [string, number]> = { INNER: ["Pack intermedio", 1], CASE: ["Caja", 2], PALLET: ["Pallet", 3] };
export async function addPackLevel(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.products), async () => {
    need(role, STOCK, "cargar presentaciones");
    const id = s(f, "product"), level = s(f, "level"), units = num(s(f, "units"));
    if (!LEVELS[level]) throw new Error("Elegí el nivel de empaque."); if (!units || units <= 0) throw new Error("Indicá cuántas unidades trae la presentación.");
    const { data: p } = await sb.from("products").select("gtin").eq("id", id).eq("organization_id", org.id).maybeSingle();
    let g = s(f, "gtin").replace(/[\s-]/g, "");
    if (!g) {
      if (!p?.gtin) throw new Error("El producto necesita un GTIN de unidad para derivar el de la presentación.");
      const ind = num(s(f, "indicator")) ?? LEVELS[level][1]; g = buildGtin14(ind, toGtin14(p.gtin));
    }
    const v = validateGtin(g); if (!v.ok) throw new Error(v.error);
    if (await gtinTaken(sb, org.id, g, id)) throw new Error("Ese GTIN ya está en uso: probá con otro dígito indicador (1 a 8).");
    const { error } = await sb.from("product_gtins").insert({ organization_id: org.id, product_id: id, gtin: g, level, units_per_pack: units, description: s(f, "description") || null });
    if (error) throw new Error(dbError(error));
    return { ok: `Presentación guardada: ${LEVELS[level][0]} ${g} (${units} u.)` };
  }, "Presentación guardada");
}
export async function deletePackLevel(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.products), async () => {
    need(role, STOCK, "quitar presentaciones");
    const { error } = await sb.from("product_gtins").delete().eq("id", s(f, "id")).eq("organization_id", org.id); if (error) throw new Error(error.message);
  }, "Presentación eliminada");
}

// ---------- Datos maestros ----------
export async function saveMaster(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.products), async () => {
    need(role, STOCK, "editar datos maestros");
    const n = (k: string) => { const v = num(s(f, k)); if (v !== null && (Number.isNaN(v) || v < 0)) throw new Error(`«${k}» debe ser un número igual o mayor que cero.`); return v; };
    const gpc = s(f, "gpc_brick"); if (gpc && !/^\d{8}$/.test(gpc)) throw new Error("El código GPC (brick) tiene 8 dígitos.");
    const row = { product_id: s(f, "product"), organization_id: org.id, brand: s(f, "brand") || null, gpc_brick: gpc || null, net_content: n("net_content"), net_content_uom: s(f, "net_content_uom") || null, gross_weight: n("gross_weight"), net_weight: n("net_weight"), weight_uom: s(f, "weight_uom") || "KGM",
      height: n("height"), width: n("width"), depth: n("depth"), dimension_uom: s(f, "dimension_uom") || "CMT", origin_country: s(f, "origin_country") || null, target_market: s(f, "target_market") || "032", shelf_life_days: n("shelf_life_days"),
      storage_min_c: num(s(f, "storage_min_c")), storage_max_c: num(s(f, "storage_max_c")), product_url: s(f, "product_url") || null, image_url: s(f, "image_url") || null, description_long: s(f, "description_long") || null, updated_at: new Date().toISOString() };
    for (const u of ["product_url", "image_url"] as const) if (row[u] && !/^https?:\/\//i.test(row[u]!)) throw new Error("Las direcciones web deben empezar con http:// o https://");
    const { error } = await sb.from("product_gs1").upsert(row); if (error) throw new Error(error.message);
  }, "Datos maestros guardados");
}

// ---------- Ubicaciones (GLN) y unidades logísticas (SSCC) ----------
export async function saveWarehouseGln(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.locations), async () => {
    need(role, STOCK, "asignar GLN");
    let gln = s(f, "gln").replace(/\D/g, "");
    if (!gln && f.get("auto")) { const st = await getSettings(sb, org.id); if (!st.company_prefix) throw new Error("Primero cargá el prefijo de empresa GS1 en «Configuración»."); const { data: n, error } = await sb.rpc("gs1_next", { p_org: org.id, p_kind: "GLN" }); if (error) throw new Error(error.message); gln = buildGln(st.company_prefix, Number(n)); }
    const { error } = await sb.rpc("set_warehouse_gln", { p_org: org.id, p_wh: s(f, "warehouse"), p_gln: gln || null }); if (error) throw new Error(error.message);
  }, "GLN del depósito guardado");
}
export async function assignSscc(f: FormData) {
  const { sb, org, role } = await ctx();
  await run(back(f, PATH.locations), async () => {
    need(role, SHIP, "asignar SSCC");
    const st = await getSettings(sb, org.id); if (!st.company_prefix) throw new Error("Primero cargá el prefijo de empresa GS1 en «Configuración».");
    for (let i = 0; i < 3; i++) {
      const { data: n, error } = await sb.rpc("gs1_next", { p_org: org.id, p_kind: "SSCC" }); if (error) throw new Error(error.message);
      const code = buildSscc(Number(s(f, "extension") || 3), st.company_prefix, Number(n));
      const r = await sb.rpc("set_shipment_sscc", { p_shipment: s(f, "shipment"), p_sscc: code });
      if (!r.error) return { ok: `SSCC asignado: ${code}` };
      if (!/duplicate|unique/i.test(r.error.message)) throw new Error(r.error.message);
    }
    throw new Error("No se pudo generar un SSCC libre.");
  }, "SSCC asignado");
}
