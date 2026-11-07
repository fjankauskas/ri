// Cliente de la API de consulta de GS1 Argentina (V2): token OAuth (usuario + contraseña + clientid) y consulta de GTIN.
export type Gs1arEnv = "testing" | "production";
export const ENDPOINTS: Record<Gs1arEnv, { token: string; api: string }> = {
  testing: { token: "https://wst.gs1.org.ar/token", api: "https://wst.gs1.org.ar/v2" },
  production: { token: "https://ws01.gs1.org.ar/token", api: "https://ws01.gs1.org.ar/v2" },
};
export const ENV_LABEL: Record<Gs1arEnv, string> = { testing: "Pruebas (testing)", production: "Producción" };
export type Creds = { username: string; password: string; clientid: string };
export type ErrCode = "NO_ACCOUNT" | "AUTH" | "NO_COMPANY" | "DEBT" | "INACTIVE" | "NO_ACCESS" | "INVALID_GTIN" | "NOT_FOUND" | "NETWORK" | "UNKNOWN";
export class Gs1arError extends Error { constructor(public code: ErrCode, message: string, public status = 0, public raw = "") { super(message); } }
export type FetchLike = (url: string, init?: any) => Promise<{ status: number; text(): Promise<string> }>;

const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Convierte los mensajes de error que documenta GS1 Argentina en un código y un texto claro. */
export function classify(message: string): { code: ErrCode; text: string } {
  const m = plain(message);
  if (/no se encontro la empresa/.test(m)) return { code: "NO_COMPANY", text: "El usuario de GS1 Argentina no tiene una empresa asignada. Pedile a GS1 que lo asocie a tu empresa." };
  if (/tiene deuda/.test(m)) return { code: "DEBT", text: "GS1 Argentina informa que la empresa tiene deuda: regularizala para poder consultar." };
  if (/esta inactiva/.test(m)) return { code: "INACTIVE", text: "La empresa figura inactiva en GS1 Argentina." };
  if (/no tiene permisos/.test(m)) return { code: "NO_ACCESS", text: "El usuario no tiene permisos para este servicio de GS1 Argentina." };
  if (/gtin14 no existe/.test(m)) return { code: "NOT_FOUND", text: "Ese GTIN-14 no existe en GS1." };
  if (/no cumple con los estandares/.test(m)) return { code: "INVALID_GTIN", text: "El GTIN no cumple con los estándares de GS1 Argentina y no está registrado." };
  if (/dato no valido/.test(m)) return { code: "INVALID_GTIN", text: "GS1 Argentina consideró que el dato enviado no es válido." };
  if (/no es numerico/.test(m)) return { code: "INVALID_GTIN", text: "El GTIN debe ser numérico." };
  if (/digito verificador invalido/.test(m)) return { code: "INVALID_GTIN", text: "El dígito verificador del GTIN es inválido." };
  if (/este producto no existe/.test(m)) return { code: "NOT_FOUND", text: /base de datos de gs1 argentina/.test(m) ? "GS1 Argentina no tiene registrado este producto." : "Este producto no existe en GS1." };
  return { code: "UNKNOWN", text: message.trim() || "GS1 Argentina respondió con un error." };
}
/** Saca el texto del error de una respuesta (texto plano, JSON con Message/error_description, o una cadena JSON). */
export function extractMessage(body: string): string {
  const t = body.trim(); if (!t) return "";
  try { const j = JSON.parse(t); if (typeof j === "string") return j; if (j && typeof j === "object") return String(j.Message ?? j.message ?? j.error_description ?? j.error ?? j.detail ?? t); } catch { /* texto plano */ }
  return t.replace(/^"|"$/g, "");
}
async function send(f: FetchLike, url: string, init: any, ms = 15000): Promise<{ status: number; text: string }> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try { const r = await f(url, { ...init, signal: ctl.signal }); return { status: r.status, text: await r.text() }; }
  catch (e: any) { throw new Gs1arError("NETWORK", e?.name === "AbortError" ? "GS1 Argentina tardó demasiado en responder." : "No se pudo conectar con GS1 Argentina. Revisá tu conexión e intentá de nuevo."); }
  finally { clearTimeout(timer); }
}

/** Pide un token (dura 24 h). El manual muestra los parámetros como QUERY; se envían en el cuerpo y, si el servidor no los acepta así, se reintenta en la URL. */
export async function requestToken(env: Gs1arEnv, c: Creds, f: FetchLike = fetch as any, now = Date.now()): Promise<{ token: string; expiresAt: Date }> {
  const form = new URLSearchParams({ grant_type: "password", username: c.username, password: c.password, clientid: c.clientid });
  const attempt = (inQuery: boolean) => send(f, inQuery ? `${ENDPOINTS[env].token}?${form}` : ENDPOINTS[env].token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", crossDomain: "true" }, body: inQuery ? "" : form.toString() });
  let r = await attempt(false);
  if (r.status === 400 && /unsupported_grant_type|invalid_request/i.test(r.text)) r = await attempt(true);
  let j: any = null; try { j = JSON.parse(r.text); } catch { /* sin JSON */ }
  if (r.status === 200 && j?.access_token) {
    const exp = Number(j.expires_in) > 0 ? new Date(now + Number(j.expires_in) * 1000) : j[".expires"] ? new Date(j[".expires"]) : new Date(now + 3600_000);
    return { token: String(j.access_token), expiresAt: exp };
  }
  const msg = extractMessage(r.text), c2 = classify(msg);
  if (c2.code !== "UNKNOWN") throw new Gs1arError(c2.code, c2.text, r.status, r.text);
  if (r.status === 400 || r.status === 401) throw new Gs1arError("AUTH", j?.error_description ? `GS1 Argentina rechazó el ingreso: ${j.error_description}` : "GS1 Argentina rechazó el ingreso: revisá el usuario, la contraseña y el clientid (y que el certificado de asociado esté vigente).", r.status, r.text);
  throw new Gs1arError("UNKNOWN", `GS1 Argentina respondió con un error al pedir el token (HTTP ${r.status}).`, r.status, r.text);
}

export type Raw = Record<string, any>;
/** POST V2/api/Producto/ConsultaGTIN. Devuelve el producto o `found:false` si GS1 no lo tiene; lanza Gs1arError para el resto. */
export async function consultaGtin(env: Gs1arEnv, token: string, gtin: string, f: FetchLike = fetch as any): Promise<{ found: true; raw: Raw } | { found: false; message: string }> {
  const r = await send(f, `${ENDPOINTS[env].api}/api/Producto/ConsultaGTIN?GTIN=${encodeURIComponent(gtin)}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ GTIN: gtin }).toString() });
  if (r.status === 401) throw new Gs1arError("AUTH", "El token venció.", 401, r.text);
  let j: any = null; try { j = JSON.parse(r.text); } catch { /* sin JSON */ }
  if (r.status === 200 && j && typeof j === "object" && !Array.isArray(j) && (j.GTIN !== undefined || j.GTIN14 !== undefined)) return { found: true, raw: j };
  const c = classify(extractMessage(r.text));
  if (c.code === "NOT_FOUND" || (r.status === 404 && c.code === "UNKNOWN")) return { found: false, message: c.code === "NOT_FOUND" ? c.text : "GS1 Argentina no tiene registrado este producto." };
  if (r.status === 403 && c.code === "UNKNOWN") throw new Gs1arError("NO_ACCESS", "El usuario no tiene permisos para este servicio de GS1 Argentina.", 403, r.text);
  if (c.code !== "UNKNOWN") throw new Gs1arError(c.code, c.text, r.status, r.text);
  throw new Gs1arError("UNKNOWN", `GS1 Argentina respondió con un error (HTTP ${r.status}).`, r.status, r.text);
}
