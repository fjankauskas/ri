import { userAgent, NO_CONTACT_MESSAGE, type OffConfig } from "./config";
// Consulta de un producto en la API v3 de OFF. Un error externo nunca se confunde con «producto inexistente».
export type FetchLike = (url: string, init?: any) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;
export type ProductOutcome =
  | { kind: "found"; product: Record<string, unknown> }
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfterS: number | null }
  | { kind: "unavailable"; message: string }
  | { kind: "invalid_response"; message: string }
  | { kind: "disabled"; message: string };
const sleepReal = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const PRODUCT_FIELDS = (fields: readonly string[]) => ["code", "last_modified_t", "countries_tags", ...fields].join(",");
async function once(f: FetchLike, url: string, ua: string, ms: number) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await f(url, { headers: { "User-Agent": ua, Accept: "application/json" }, signal: ctl.signal }); return { status: r.status, retry: r.headers.get("retry-after"), text: await r.text() }; }
  finally { clearTimeout(t); }
}
/** GET /api/v3/product/{código}. Reintenta pocas veces (espera exponencial) ante 503 o fallas de red; ante 429 no insiste. */
export async function fetchProductV3(cfg: OffConfig, code: string, f: FetchLike = fetch as any, sleep: (ms: number) => Promise<unknown> = sleepReal): Promise<ProductOutcome> {
  const ua = userAgent(cfg); if (!ua) return { kind: "disabled", message: NO_CONTACT_MESSAGE };
  const url = `${cfg.apiBase}/api/v3/product/${encodeURIComponent(code)}?fields=${encodeURIComponent(PRODUCT_FIELDS(cfg.fields))}`;
  let last = "";
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const r = await once(f, url, ua, cfg.requestTimeoutMs);
      if (r.status === 429) { const s = Number(r.retry); return { kind: "rate_limited", retryAfterS: Number.isFinite(s) && s > 0 ? s : null }; }
      if (r.status === 404) return { kind: "not_found" };
      if (r.status >= 500) { last = `Open Food Facts respondió HTTP ${r.status}.`; if (attempt < cfg.maxRetries) { await sleep(Math.min(500 * 2 ** attempt, 4000)); continue; } return { kind: "unavailable", message: last }; }
      let j: any; try { j = JSON.parse(r.text); } catch { return { kind: "invalid_response", message: "Open Food Facts devolvió una respuesta que no es JSON." }; }
      if (j && typeof j === "object" && !Array.isArray(j)) {
        const status = String(j.status ?? j.status_id ?? "").toLowerCase(), rid = String(j.result?.id ?? "").toLowerCase();
        if (rid === "product_not_found" || status === "failure" || j.status === 0) return { kind: "not_found" };
        if (j.product && typeof j.product === "object") return { kind: "found", product: { code, ...j.product } };
      }
      if (r.status >= 400) return { kind: "invalid_response", message: `Open Food Facts respondió HTTP ${r.status}.` };
      return { kind: "invalid_response", message: "La respuesta de Open Food Facts no trae el producto." };
    } catch (e: any) {
      last = e?.name === "AbortError" ? "Open Food Facts tardó demasiado en responder." : "No se pudo conectar con Open Food Facts.";
      if (attempt < cfg.maxRetries) { await sleep(Math.min(500 * 2 ** attempt, 4000)); continue; }
    }
  }
  return { kind: "unavailable", message: last || "Open Food Facts no está disponible." };
}
