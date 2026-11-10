import type { OffRecord } from "./normalize";
// Acceso a datos: una interfaz (para probar sin base) y su implementación sobre Supabase con la clave de servicio.
export type OffRow = OffRecord & { id?: string; source?: string; origin: "bulk" | "delta" | "on_demand"; imported_at?: string; updated_at?: string; last_seen_at?: string | null; last_seen_run?: string | null; first_run?: string | null };
export type Run = {
  id: string; kind: "full" | "delta"; status: "running" | "completed" | "failed" | "interrupted"; source_label: string | null; source_url: string | null; started_at: string; finished_at: string | null; heartbeat_at: string;
  rows_read: number; processed: number; inserted: number; updated: number; unchanged: number; rejected: number; errors: number; watermark_t: number | null; cursor: { line?: number; file?: string } | null; error_summary: string | null;
};
export type AlertKind = "import_failed" | "count_drop" | "api_down" | "rate_limited" | "validation_errors";
export interface OffStore {
  getProduct(gtin14: string): Promise<OffRow | null>;
  existing(gtins: string[]): Promise<Map<string, string | null>>;
  insertProducts(rows: OffRow[]): Promise<void>;
  updateProducts(rows: OffRow[]): Promise<void>;
  touch(runId: string, gtins: string[]): Promise<void>;
  getNotFound(gtin14: string): Promise<Date | null>;
  putNotFound(gtin14: string, expiresAt: Date): Promise<void>;
  clearNotFound(gtin14: string): Promise<void>;
  claim(gtin14: string, ttlSeconds: number): Promise<boolean>;
  release(gtin14: string): Promise<void>;
  acquire(bucket: string, perMinute: number): Promise<boolean>;
  getState<T>(key: string): Promise<T | null>;
  setState(key: string, value: unknown): Promise<void>;
  findRunning(): Promise<Run | null>;
  latestRun(kind: "full" | "delta" | "any", statuses: Run["status"][]): Promise<Run | null>;
  createRun(r: { kind: "full" | "delta"; source_label: string | null; source_url: string | null; watermark_t?: number | null }): Promise<Run>;
  updateRun(id: string, patch: Partial<Run>): Promise<void>;
  getRun(id: string): Promise<Run | null>;
  addIssues(runId: string, issues: { code: string; reason: string }[]): Promise<void>;
  addAlert(kind: AlertKind, message: string, detail?: unknown): Promise<boolean>;
  counts(): Promise<{ total: number; argentina: number }>;
}
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const must = <T,>(r: { data?: T; error: any }): T => { if (r.error) throw new Error(r.error.message ?? String(r.error)); return r.data as T; };

export function supabaseStore(sb: any): OffStore {
  const runs = () => sb.from("off_import_runs");
  return {
    async getProduct(g) { return must(await sb.from("off_products").select("*").eq("gtin14", g).maybeSingle()) ?? null; },
    async existing(gtins) {
      const m = new Map<string, string | null>();
      for (const c of chunk(gtins, 200)) for (const r of must<any[]>(await sb.from("off_products").select("gtin14, off_last_modified_at").in("gtin14", c)) ?? []) m.set(r.gtin14, r.off_last_modified_at);
      return m;
    },
    async insertProducts(rows) { for (const c of chunk(rows, 500)) must(await sb.from("off_products").upsert(c, { onConflict: "gtin14" })); },
    async updateProducts(rows) {
      const now = new Date().toISOString();
      for (const c of chunk(rows, 500)) must(await sb.from("off_products").upsert(c.map(({ imported_at, first_run, id, ...r }) => ({ ...r, updated_at: now })), { onConflict: "gtin14" }));
    },
    async touch(runId, gtins) { for (const c of chunk(gtins, 500)) must(await sb.rpc("off_touch", { p_run: runId, p_gtins: c })); },
    async getNotFound(g) { const r = must<any>(await sb.from("off_lookups").select("expires_at").eq("gtin14", g).maybeSingle()); return r ? new Date(r.expires_at) : null; },
    async putNotFound(g, exp) { must(await sb.from("off_lookups").upsert({ gtin14: g, status: "not_found", checked_at: new Date().toISOString(), expires_at: exp.toISOString() })); },
    async clearNotFound(g) { must(await sb.from("off_lookups").delete().eq("gtin14", g)); },
    async claim(g, ttl) { return !!must(await sb.rpc("off_claim", { p_gtin: g, p_ttl: ttl })); },
    async release(g) { must(await sb.rpc("off_release", { p_gtin: g })); },
    async acquire(b, n) { return !!must(await sb.rpc("off_acquire", { p_bucket: b, p_limit: n })); },
    async getState<T>(k: string) { const r = must<any>(await sb.from("off_state").select("value").eq("key", k).maybeSingle()); return (r?.value as T) ?? null; },
    async setState(k, v) { must(await sb.from("off_state").upsert({ key: k, value: v, updated_at: new Date().toISOString() })); },
    async findRunning() { return must(await runs().select("*").eq("status", "running").maybeSingle()) ?? null; },
    async latestRun(kind, statuses) { let q = runs().select("*").in("status", statuses); if (kind !== "any") q = q.eq("kind", kind); return must<any[]>(await q.order("started_at", { ascending: false }).limit(1))?.[0] ?? null; },
    async createRun(r) { return must(await runs().insert({ ...r, status: "running" }).select("*").single()); },
    async updateRun(id, patch) { must(await runs().update({ ...patch, heartbeat_at: new Date().toISOString() }).eq("id", id)); },
    async getRun(id) { return must(await runs().select("*").eq("id", id).maybeSingle()) ?? null; },
    async addIssues(runId, issues) { if (issues.length) must(await sb.from("off_import_issues").insert(issues.map((i) => ({ run_id: runId, ...i })))); },
    async addAlert(kind, message, detail) {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const dup = must<any[]>(await sb.from("off_alerts").select("id").eq("kind", kind).is("resolved_at", null).gte("created_at", since).limit(1));
      if (dup?.length) return false;
      must(await sb.from("off_alerts").insert({ kind, message, detail: detail ?? null })); return true;
    },
    async counts() {
      const all = await sb.from("off_products").select("*", { count: "exact", head: true }), ar = await sb.from("off_products").select("*", { count: "exact", head: true }).eq("in_argentina", true);
      return { total: all.count ?? 0, argentina: ar.count ?? 0 };
    },
  };
}
