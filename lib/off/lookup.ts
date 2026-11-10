import { validateGtin, toGtin14 } from "../gs1/check";
import { fetchProductV3, type FetchLike } from "./client";
import { userAgent, NO_CONTACT_MESSAGE, type OffConfig } from "./config";
import { normalizeRaw, type OffRecord } from "./normalize";
import type { OffRow, OffStore } from "./store";
// Consulta bajo demanda de un GTIN escaneado: catálogo local → caché negativa → Open Food Facts (una sola consulta por GTIN a la vez).
export type OffResult =
  | { status: "local"; product: OffRow }
  | { status: "found"; product: OffRow }
  | { status: "not_found"; cached: boolean }
  | { status: "miss" }
  | { status: "rate_limited"; retryAfterS: number | null }
  | { status: "unavailable"; message: string }
  | { status: "invalid_response"; message: string }
  | { status: "invalid_gtin"; message: string }
  | { status: "disabled"; message: string }
  | { status: "pending" };
export type Deps = { store: OffStore; cfg: OffConfig; fetch?: FetchLike; now?: () => number; sleep?: (ms: number) => Promise<unknown>; notify?: (kind: "api_down" | "rate_limited", message: string) => Promise<unknown> };
const BREAKER = "breaker";
type Breaker = { failures: number; openUntil: number };
const POLL_MS = 400, POLL_TRIES = 10;
const real = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function offLookup(d: Deps, input: string, opts: { localOnly?: boolean } = {}): Promise<OffResult> {
  const { store, cfg } = d, now = d.now ?? Date.now, sleep = d.sleep ?? real;
  const v = validateGtin(input); if (!v.ok) return { status: "invalid_gtin", message: v.error! };
  const digits = input.replace(/[\s-]/g, ""), key = toGtin14(digits);
  const local = await store.getProduct(key); if (local) return { status: "local", product: local };
  if (opts.localOnly) return { status: "miss" };
  if (!userAgent(cfg)) return { status: "disabled", message: NO_CONTACT_MESSAGE };
  const neg = await store.getNotFound(key); if (neg && neg.getTime() > now()) return { status: "not_found", cached: true };
  const br = await store.getState<Breaker>(BREAKER); if (br && br.openUntil > now()) return { status: "unavailable", message: "Open Food Facts no responde en este momento; se reintentará en unos minutos." };

  if (!(await store.claim(key, 30))) {   // otra solicitud ya está consultando este GTIN: se espera su resultado en vez de repetir la consulta
    for (let i = 0; i < POLL_TRIES; i++) {
      await sleep(POLL_MS);
      const p = await store.getProduct(key); if (p) return { status: "local", product: p };
      const n = await store.getNotFound(key); if (n && n.getTime() > now()) return { status: "not_found", cached: true };
    }
    return { status: "pending" };
  }
  try {
    if (!(await store.acquire("product", cfg.productPerMinute))) {
      await d.notify?.("rate_limited", "Se alcanzó el límite propio de consultas a Open Food Facts; se reintentará con el próximo escaneo.");
      return { status: "rate_limited", retryAfterS: 30 };
    }
    const candidates = digits.length === 12 ? [digits, "0" + digits] : [digits];   // un UPC-A de 12 dígitos figura en OFF con un cero adelante
    let out = await fetchProductV3(cfg, candidates[0], d.fetch, sleep);
    if (out.kind === "not_found" && candidates[1]) out = await fetchProductV3(cfg, candidates[1], d.fetch, sleep);
    switch (out.kind) {
      case "disabled": return { status: "disabled", message: out.message };
      case "rate_limited": await d.notify?.("rate_limited", "Open Food Facts respondió 429 (límite de consultas alcanzado)."); return { status: "rate_limited", retryAfterS: out.retryAfterS };
      case "unavailable": {
        const b = (await store.getState<Breaker>(BREAKER)) ?? { failures: 0, openUntil: 0 }, failures = b.failures + 1, open = failures >= cfg.failuresBeforeBreak;
        await store.setState(BREAKER, { failures: open ? 0 : failures, openUntil: open ? now() + cfg.breakSeconds * 1000 : 0 });
        if (open) await d.notify?.("api_down", `Open Food Facts no respondió ${failures} veces seguidas: ${out.message}`);
        return { status: "unavailable", message: out.message };
      }
      case "invalid_response": return { status: "invalid_response", message: out.message };
      case "not_found": await store.putNotFound(key, new Date(now() + cfg.negativeTtlDays * 864e5)); await resetBreaker(store); return { status: "not_found", cached: false };
      case "found": {
        await resetBreaker(store);
        const n = normalizeRaw(out.product, cfg.fields);
        if (!n.ok) { await store.putNotFound(key, new Date(now() + cfg.emptyTtlDays * 864e5)); return { status: "not_found", cached: false }; }
        const row: OffRow = { ...(n.rec as OffRecord), gtin14: key, origin: "on_demand", last_seen_at: null, last_seen_run: null };
        await store.insertProducts([row]); await store.clearNotFound(key);
        return { status: "found", product: (await store.getProduct(key)) ?? row };
      }
    }
  } finally { await store.release(key); }
}
async function resetBreaker(store: OffStore) { const b = await store.getState<Breaker>(BREAKER); if (b && (b.failures || b.openUntil)) await store.setState(BREAKER, { failures: 0, openUntil: 0 }); }
