import type { AlertKind, OffRow, OffStore, Run } from "../lib/off/store";
// Almacenamiento en memoria con el mismo comportamiento que la base (para probar sin depender de Supabase ni de Open Food Facts).
export function memoryStore(clock: () => number = Date.now) {
  const products = new Map<string, OffRow>(), neg = new Map<string, Date>(), inflight = new Map<string, number>(), rate = new Map<string, number>(), state = new Map<string, unknown>();
  const runs: Run[] = [], issues: { run_id: string; code: string; reason: string }[] = [], alerts: { kind: AlertKind; message: string; at: number }[] = [];
  const calls = { upsert: 0, touch: 0 };
  let seq = 0;
  const store: OffStore & { products: typeof products; runs: Run[]; issues: typeof issues; alerts: typeof alerts; calls: typeof calls; neg: typeof neg } = {
    products, runs, issues, alerts, calls, neg,
    async getProduct(g) { return products.get(g) ?? null; },
    async existing(gs) { const m = new Map<string, string | null>(); for (const g of gs) { const p = products.get(g); if (p) m.set(g, p.off_last_modified_at); } return m; },
    async insertProducts(rows) { calls.upsert++; for (const r of rows) products.set(r.gtin14, { ...(products.get(r.gtin14) ?? {}), ...r, id: products.get(r.gtin14)?.id ?? `p${++seq}`, imported_at: products.get(r.gtin14)?.imported_at ?? new Date(clock()).toISOString() }); },
    async updateProducts(rows) { for (const r of rows) { const { imported_at, first_run, id, ...rest } = r; products.set(r.gtin14, { ...products.get(r.gtin14)!, ...rest }); } },
    async touch(run, gs) { calls.touch++; for (const g of gs) { const p = products.get(g); if (p) { p.last_seen_run = run; p.last_seen_at = new Date(clock()).toISOString(); } } },
    async getNotFound(g) { return neg.get(g) ?? null; }, async putNotFound(g, e) { neg.set(g, e); }, async clearNotFound(g) { neg.delete(g); },
    async claim(g, ttl) { const t = inflight.get(g); if (t !== undefined && clock() - t < ttl * 1000) return false; inflight.set(g, clock()); return true; },
    async release(g) { inflight.delete(g); },
    async acquire(b, n) { const k = `${b}:${Math.floor(clock() / 60000)}`; const c = (rate.get(k) ?? 0) + 1; rate.set(k, c); return c <= n; },
    async getState<T>(k: string) { return (state.get(k) as T) ?? null; }, async setState(k, v) { state.set(k, v); },
    async findRunning() { return runs.find((r) => r.status === "running") ?? null; },
    async latestRun(kind, st) { return [...runs].filter((r) => (kind === "any" || r.kind === kind) && st.includes(r.status)).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0] ?? null; },
    async createRun(r) { if (runs.some((x) => x.status === "running")) throw new Error("duplicate key value violates unique constraint off_one_running_import"); const run: Run = { id: `run${++seq}`, kind: r.kind, status: "running", source_label: r.source_label, source_url: r.source_url, started_at: new Date(clock()).toISOString(), finished_at: null, heartbeat_at: new Date(clock()).toISOString(), rows_read: 0, processed: 0, inserted: 0, updated: 0, unchanged: 0, rejected: 0, errors: 0, watermark_t: r.watermark_t ?? null, cursor: null, error_summary: null }; runs.push(run); return { ...run }; },
    async updateRun(id, patch) { Object.assign(runs.find((r) => r.id === id)!, patch, { heartbeat_at: new Date(clock()).toISOString() }); },
    async getRun(id) { const r = runs.find((x) => x.id === id); return r ? { ...r } : null; },
    async addIssues(run_id, is) { for (const i of is) issues.push({ run_id, ...i }); },
    async addAlert(kind, message) { if (alerts.some((a) => a.kind === kind && clock() - a.at < 3600_000)) return false; alerts.push({ kind, message, at: clock() }); return true; },
    async counts() { const all = [...products.values()]; return { total: all.length, argentina: all.filter((p) => p.in_argentina).length }; },
  };
  return store;
}
