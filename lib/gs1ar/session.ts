import { consultaGtin, requestToken, Gs1arError, type Creds, type FetchLike, type Gs1arEnv } from "./client";
import { normalizeProduct, type Gs1arProduct } from "./normalize";
// Manejo del token: se reutiliza mientras esté vigente (GS1 lo da por 24 h) y se renueva solo si GS1 lo rechaza.
export interface TokenStore { get(): Promise<{ token: string; expiresAt: Date } | null>; set(t: { token: string; expiresAt: Date }): Promise<void>; clear(): Promise<void> }
const MARGIN = 5 * 60_000;
export async function withToken<T>(env: Gs1arEnv, creds: Creds, store: TokenStore, fn: (token: string) => Promise<T>, f?: FetchLike, now: () => number = Date.now): Promise<T> {
  const fresh = async () => { const t = await requestToken(env, creds, f, now()); await store.set(t); return t.token; };
  const cached = await store.get();
  let token = cached && cached.expiresAt.getTime() - MARGIN > now() ? cached.token : await fresh();
  try { return await fn(token); }
  catch (e) { if (e instanceof Gs1arError && e.code === "AUTH" && e.status === 401) { await store.clear(); token = await fresh(); return await fn(token); } throw e; }
}
export type Found = { found: true; product: Gs1arProduct; raw: Record<string, any> } | { found: false; message: string };
export async function lookupWith(env: Gs1arEnv, creds: Creds, store: TokenStore, gtin: string, f?: FetchLike, now?: () => number): Promise<Found> {
  const r = await withToken(env, creds, store, (t) => consultaGtin(env, t, gtin, f), f, now);
  return r.found ? { found: true, product: normalizeProduct(r.raw), raw: r.raw } : r;
}
