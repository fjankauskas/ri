import { createAdmin } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret, hasEncryptionKey } from "@/lib/arca/crypto";
import { toGtin14, validateGtin } from "@/lib/gs1/check";
import { ENV_LABEL, Gs1arError, requestToken, type ErrCode, type Gs1arEnv } from "./client";
import { lookupWith, type TokenStore } from "./session";
import { normalizeProduct, type Gs1arProduct } from "./normalize";
// Servidor: credenciales cifradas por empresa, token en caché, caché de consultas y registro. Solo se llama después de verificar permisos.
const TTL_FOUND = 7 * 864e5, TTL_MISSING = 12 * 36e5;
const NO_ACCOUNT = "Todavía no configuraste tu usuario de GS1 Argentina. Cargalo en GS1 → Configuración.";
type Account = { environment: Gs1arEnv; username: string; clientid: string; password_enc: string };
export type Lookup =
  | { ok: true; found: true; product: Gs1arProduct; cached: boolean; fetchedAt: string; env: Gs1arEnv }
  | { ok: true; found: false; message: string; cached: boolean }
  | { ok: false; code: ErrCode; message: string };

async function activeAccount(sb: any, orgId: string): Promise<Account | null> {
  const { data } = await sb.from("gs1ar_accounts").select("environment, username, clientid, password_enc").eq("organization_id", orgId).eq("is_active", true).maybeSingle();
  return (data as Account) ?? null;
}
/** Datos de la cuenta sin la contraseña (para mostrar en pantalla). */
export async function accountSummary(orgId: string): Promise<{ env: Gs1arEnv; username: string; clientid: string } | null> {
  const a = await activeAccount(createAdmin(), orgId); return a ? { env: a.environment, username: a.username, clientid: a.clientid } : null;
}
export async function saveAccount(orgId: string, v: { env: Gs1arEnv; username: string; clientid: string; password?: string }) {
  if (!hasEncryptionKey()) throw new Error("Falta ARCA_ENCRYPTION_KEY en .env.local (es la clave con la que se cifran las contraseñas guardadas).");
  const sb = createAdmin();
  const { data: cur } = await sb.from("gs1ar_accounts").select("password_enc").eq("organization_id", orgId).eq("environment", v.env).maybeSingle();
  if (!v.password && !cur) throw new Error("Ingresá la contraseña de GS1 Argentina.");
  await sb.from("gs1ar_accounts").update({ is_active: false }).eq("organization_id", orgId);
  const { error } = await sb.from("gs1ar_accounts").upsert({ organization_id: orgId, environment: v.env, username: v.username, clientid: v.clientid, password_enc: v.password ? encryptSecret(v.password) : (cur as any).password_enc, is_active: true, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  await sb.from("gs1ar_tokens").delete().eq("organization_id", orgId).eq("environment", v.env);
}
const storeFor = (sb: any, orgId: string, env: Gs1arEnv): TokenStore => ({
  async get() { const { data } = await sb.from("gs1ar_tokens").select("token_enc, expires_at").eq("organization_id", orgId).eq("environment", env).maybeSingle(); return data ? { token: decryptSecret(data.token_enc), expiresAt: new Date(data.expires_at) } : null; },
  async set(t) { await sb.from("gs1ar_tokens").upsert({ organization_id: orgId, environment: env, token_enc: encryptSecret(t.token), expires_at: t.expiresAt.toISOString() }); },
  async clear() { await sb.from("gs1ar_tokens").delete().eq("organization_id", orgId).eq("environment", env); },
});
const log = async (sb: any, orgId: string, env: Gs1arEnv, action: "token" | "gtin", gtin: string | null, status: number | null, ok: boolean, message: string, ms: number) => {
  try { await sb.from("gs1ar_log").insert({ organization_id: orgId, environment: env, action, gtin, http_status: status, ok, message: message.slice(0, 300), ms }); } catch { /* el registro nunca debe romper una consulta */ }
};
const creds = (a: Account) => ({ username: a.username, clientid: a.clientid, password: decryptSecret(a.password_enc) });

/** Consulta un GTIN en GS1 Argentina (con caché de 7 días). Valida el GTIN antes de gastar una consulta. */
export async function lookupGtin(orgId: string, input: string, opts: { force?: boolean } = {}): Promise<Lookup> {
  const v = validateGtin(input); if (!v.ok) return { ok: false, code: "INVALID_GTIN", message: v.error! };
  const digits = input.replace(/[\s-]/g, ""), key = toGtin14(digits);
  let sb: any, acc: Account | null; try { sb = createAdmin(); acc = await activeAccount(sb, orgId); } catch (e: any) { return { ok: false, code: "UNKNOWN", message: e?.message ?? "No se pudo leer la configuración." }; }
  if (!acc) return { ok: false, code: "NO_ACCOUNT", message: NO_ACCOUNT };
  const { data: row } = await sb.from("gs1ar_products").select("found, data, message, fetched_at").eq("organization_id", orgId).eq("environment", acc.environment).eq("gtin", key).maybeSingle();
  const age = row ? Date.now() - new Date(row.fetched_at).getTime() : Infinity, fresh = row && age < (row.found ? TTL_FOUND : TTL_MISSING);
  const fromCache = (): Lookup => (row.found ? { ok: true, found: true, product: normalizeProduct(row.data), cached: true, fetchedAt: row.fetched_at, env: acc!.environment } : { ok: true, found: false, message: row.message ?? "GS1 Argentina no tiene registrado este producto.", cached: true });
  if (!opts.force && fresh) return fromCache();
  const t0 = Date.now();
  try {
    const r = await lookupWith(acc.environment, creds(acc), storeFor(sb, orgId, acc.environment), digits);
    await log(sb, orgId, acc.environment, "gtin", key, 200, true, r.found ? `Encontrado: ${r.product.descripcion} (${r.product.marca})` : r.message, Date.now() - t0);
    const now = new Date().toISOString();
    await sb.from("gs1ar_products").upsert({ organization_id: orgId, environment: acc.environment, gtin: key, found: r.found, data: r.found ? r.raw : null, message: r.found ? null : r.message, fetched_at: now });
    return r.found ? { ok: true, found: true, product: r.product, cached: false, fetchedAt: now, env: acc.environment } : { ok: true, found: false, message: r.message, cached: false };
  } catch (e: any) {
    const err = e instanceof Gs1arError ? e : new Gs1arError("UNKNOWN", e?.message ?? "Error inesperado");
    await log(sb, orgId, acc.environment, "gtin", key, err.status || null, false, `${err.code}: ${err.message}`, Date.now() - t0);
    if (row && (err.code === "NETWORK" || err.code === "UNKNOWN")) return fromCache();   // sin conexión: se usa la última copia guardada
    return { ok: false, code: err.code, message: err.message };
  }
}
/** Prueba el ingreso (pide un token nuevo) y, si se indica, consulta un GTIN. */
export async function testConnection(orgId: string, sample?: string): Promise<string> {
  const sb = createAdmin(), acc = await activeAccount(sb, orgId); if (!acc) throw new Error(NO_ACCOUNT);
  const t0 = Date.now(); let expires: Date;
  try { const t = await requestToken(acc.environment, creds(acc)); expires = t.expiresAt; await storeFor(sb, orgId, acc.environment).set(t); await log(sb, orgId, acc.environment, "token", null, 200, true, "Token obtenido", Date.now() - t0); }
  catch (e: any) { await log(sb, orgId, acc.environment, "token", null, e?.status || null, false, `${e?.code ?? "UNKNOWN"}: ${e?.message}`, Date.now() - t0); throw new Error(e?.message ?? "No se pudo obtener el token."); }
  let extra = ""; if (sample) { const r = await lookupGtin(orgId, sample, { force: true }); extra = r.ok ? (r.found ? ` Consulta de prueba: ${r.product.descripcion || r.product.gtin} (${r.product.marca}).` : ` Consulta de prueba: ${r.message}`) : ` Consulta de prueba con problema: ${r.message}`; }
  return `Conexión correcta con GS1 Argentina (${ENV_LABEL[acc.environment]}). Token válido hasta ${expires.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.${extra}`;
}
