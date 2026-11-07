"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/ctx";
import { mustCan } from "@/lib/perms-server";
import { validateGtin } from "@/lib/gs1/check";
import { completeness, type Master } from "@/lib/gs1/master";
import { gtinTaken } from "@/lib/gs1/data";
import { ENV_LABEL } from "@/lib/gs1ar/client";
import { masterFromGs1ar, mergeMaster, suggestedName, unitFor } from "@/lib/gs1ar/normalize";
import { lookupGtin, saveAccount, testConnection } from "@/lib/gs1ar/service";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const PATH = { config: "/gs1?v=config", products: "/gs1?v=products" };
const back = (f: FormData, def: string) => (/^\/gs1(\?[\w=&%.|\-]*)?$/.test(s(f, "back")) ? s(f, "back") : def);
const withParam = (path: string, k: string, v: string) => `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
const clean = (e: any) => String(e?.message ?? "Error inesperado").replace(/^[A-Z_]+: /, "");
type Result = void | { path?: string; ok?: string };
async function run(path: string, fn: () => Promise<Result>, ok: string, perm?: string[]) {
  let err = "", out: Result = undefined;
  try { if (perm) await mustCan(perm[0], perm[1]); out = await fn(); } catch (e: any) { err = clean(e); }
  revalidatePath("/", "layout");
  const to = (out && out.path) || path;
  redirect(err ? withParam(to, "e", err) : withParam(to, "ok", (out && out.ok) || ok));
}
const needAdmin = (role: string) => { if (!["OWNER", "ADMIN"].includes(role)) throw new Error("Solo los dueños y administradores pueden configurar GS1 Argentina."); };
// Errores que se repiten para cualquier GTIN: no tiene sentido seguir consultando en un lote.
const GLOBAL = new Set(["NO_ACCOUNT", "AUTH", "NO_COMPANY", "DEBT", "INACTIVE", "NO_ACCESS", "NETWORK"]);

export async function saveGs1arAccount(f: FormData) {
  const { org, role } = await ctx();
  await run(back(f, PATH.config), async () => {
    needAdmin(role);
    const env = s(f, "environment") === "testing" ? "testing" : "production";
    if (!s(f, "username") || !s(f, "clientid")) throw new Error("Ingresá el usuario y el clientid que te dio GS1 Argentina.");
    await saveAccount(org.id, { env, username: s(f, "username"), clientid: s(f, "clientid"), password: s(f, "password") || undefined });
    return { ok: `Credenciales guardadas para el ambiente ${ENV_LABEL[env]}. Probá la conexión para confirmar que funcionan.` };
  }, "Credenciales guardadas", ["gs1", "edit"]);
}
export async function testGs1ar(f: FormData) {
  const { org, role } = await ctx();
  await run(back(f, PATH.config), async () => { needAdmin(role); return { ok: await testConnection(org.id, s(f, "sample") || undefined) }; }, "Conexión correcta", ["gs1", "edit"]);
}

/** Completa los datos maestros de un producto con lo que informa GS1 Argentina (solo los vacíos, salvo que se pida pisar). */
async function applyToProduct(sb: any, orgId: string, productId: string, gtin: string, overwrite: boolean, force = false) {
  const r = await lookupGtin(orgId, gtin, { force });
  if (!r.ok) throw Object.assign(new Error(r.message), { code: r.code });
  if (!r.found) throw Object.assign(new Error(r.message), { code: "NOT_FOUND" });
  const { data: cur } = await sb.from("product_gs1").select("*").eq("product_id", productId).maybeSingle();
  const { next, changed } = mergeMaster(cur as Partial<Master> | null, masterFromGs1ar(r.product), overwrite);
  if (changed.length) { const { error } = await sb.from("product_gs1").upsert({ product_id: productId, organization_id: orgId, ...next, updated_at: new Date().toISOString() }); if (error) throw new Error(error.message); }
  return changed.length;
}
export async function fillFromGs1ar(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.products), async () => {
    const { data: p } = await sb.from("products").select("id, gtin").eq("id", s(f, "product")).eq("organization_id", org.id).maybeSingle();
    if (!p?.gtin) throw new Error("El producto no tiene GTIN.");
    const n = await applyToProduct(sb, org.id, p.id, p.gtin, !!f.get("overwrite"), true);
    return { ok: n ? `Ficha completada con ${n} dato(s) de GS1 Argentina.` : "La ficha ya tenía todos los datos que informa GS1 Argentina." };
  }, "Ficha completada", ["gs1", "edit"]);
}
/** Crea un producto con los datos oficiales del GTIN (nombre, unidad, marca, contenido, país, imagen). */
export async function createProductFromGs1ar(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.products), async () => {
    const g = s(f, "gtin").replace(/[\s-]/g, ""), v = validateGtin(g); if (!v.ok) throw new Error(v.error);
    if (await gtinTaken(sb, org.id, g)) throw new Error("Ya tenés un producto con ese GTIN.");
    const r = await lookupGtin(org.id, g); if (!r.ok) throw new Error(r.message); if (!r.found) throw new Error(r.message);
    const p = r.product, cand = /^[\w.-]{1,40}$/.test(p.codigoInterno) ? p.codigoInterno : g;
    const { data: dup } = await sb.from("products").select("id").eq("organization_id", org.id).ilike("sku", cand).limit(1);
    const { data, error } = await sb.from("products").insert({ organization_id: org.id, sku: dup?.length ? g : cand, name: suggestedName(p) || `Producto ${g}`, unit: unitFor(p), gtin: g, min_stock: 0, iva: "21" }).select("id").single();
    if (error) throw new Error(error.code === "23505" ? "Ya existe un producto con ese código interno o GTIN." : error.message);
    const m = masterFromGs1ar(p); if (Object.keys(m).length) await sb.from("product_gs1").upsert({ product_id: data.id, organization_id: org.id, ...m });
    return { path: `/gs1?v=products&id=${data.id}`, ok: `Producto creado con los datos de GS1 Argentina (${p.marca || "sin marca"}). Revisá el IVA y el precio en Inventario.` };
  }, "Producto creado", ["inventory", "create"]);
}
/** Completa de una vez las fichas incompletas de productos con GTIN (hasta 25 por vez, para no sobrecargar el servicio). */
export async function fillAllFromGs1ar(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.products), async () => {
    if (!f.get("confirm")) throw new Error("Marcá la confirmación para consultar a GS1 Argentina varios productos.");
    const [{ data: prods }, { data: masters }] = await Promise.all([sb.from("products").select("id, name, gtin").eq("organization_id", org.id).eq("is_active", true).not("gtin", "is", null), sb.from("product_gs1").select("*").eq("organization_id", org.id)]);
    const M = new Map(((masters as any[]) ?? []).map((m) => [m.product_id, m]));
    const todo = ((prods as any[]) ?? []).filter((p) => completeness(p, M.get(p.id)).pct < 100).slice(0, 25);
    if (!todo.length) throw new Error("Todas las fichas con GTIN ya están completas.");
    let done = 0, missing = 0, errors = 0, stop = "";
    for (const p of todo) {
      try { const n = await applyToProduct(sb, org.id, p.id, p.gtin, false); if (n) done++; }
      catch (e: any) { if (e?.code === "NOT_FOUND" || e?.code === "INVALID_GTIN") missing++; else if (GLOBAL.has(e?.code)) { stop = e.message; break; } else errors++; }
    }
    if (stop && !done) throw new Error(stop);
    return { ok: `Fichas completadas: ${done} · sin datos en GS1: ${missing}${errors ? ` · con error: ${errors}` : ""}${stop ? ` · se detuvo: ${stop}` : ""}${todo.length === 25 ? ". Había más: repetí la acción para seguir." : "."}` };
  }, "Fichas completadas", ["gs1", "edit"]);
}
