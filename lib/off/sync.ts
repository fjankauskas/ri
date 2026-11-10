import type { OffConfig } from "./config";
import type { RecordSource } from "./export";
import { normalizeRaw, type OffRecord } from "./normalize";
import type { AlertKind, OffRow, OffStore, Run } from "./store";
// Motor de importación: procesa por lotes, compara last_modified_t, inserta/actualiza sin duplicar, nunca borra, y puede repetirse o reanudarse.
export class SyncBusyError extends Error {}
export type SyncDeps = { store: OffStore; cfg: OffConfig; now?: () => number; notify?: (kind: AlertKind, message: string) => Promise<unknown> };
export type Plan = { kind: "full" | "delta"; label: string; url?: string; watermark: number | null; sources: RecordSource[] };
type Totals = Pick<Run, "rows_read" | "processed" | "inserted" | "updated" | "unchanged" | "rejected" | "errors">;
const MAX_ISSUES = 200, DAY = 864e5;
const ts = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

/** Qué hacer en la corrida diaria: archivo completo (primera vez, cada tanto, o si los delta ya no alcanzan) o solo los cambios. */
export function decideMode(last: { completed: Run | null; fullCompleted: Run | null }, nowMs: number, cfg: OffConfig): { mode: "full" | "delta"; reason: string } {
  if (!last.completed || !last.fullCompleted) return { mode: "full", reason: "todavía no hay una importación completa" };
  if (nowMs - ts(last.fullCompleted.started_at) > cfg.fullRefreshDays * DAY) return { mode: "full", reason: `pasaron más de ${cfg.fullRefreshDays} días desde la última importación completa` };
  if (!last.completed.watermark_t || nowMs / 1000 - last.completed.watermark_t > 13 * 86400) return { mode: "full", reason: "la última sincronización es demasiado vieja para usar los archivos delta" };
  return { mode: "delta", reason: "se aplican los cambios diarios" };
}
async function raise(d: SyncDeps, kind: AlertKind, message: string, detail?: unknown) { if (await d.store.addAlert(kind, message, detail)) await d.notify?.(kind, message); }

async function begin(d: SyncDeps, plan: Plan): Promise<{ run: Run; resume: NonNullable<Run["cursor"]> | null }> {
  const { store, cfg } = d, now = d.now ?? Date.now, iso = () => new Date(now()).toISOString();
  const running = await store.findRunning();
  if (running) {
    if (now() - ts(running.heartbeat_at) < cfg.staleRunMinutes * 60_000) throw new SyncBusyError("Ya hay una sincronización en curso: no se ejecutan dos a la vez.");
    await store.updateRun(running.id, { status: "interrupted", finished_at: iso(), error_summary: "Sin actividad: se marcó como interrumpida" });
  }
  const prev = await store.latestRun(plan.kind, ["interrupted", "failed"]), done = await store.latestRun(plan.kind, ["completed"]);
  if (prev?.cursor && (!done || ts(done.started_at) < ts(prev.started_at)) && now() - ts(prev.started_at) < DAY) {   // se reanuda donde quedó
    await store.updateRun(prev.id, { status: "running", finished_at: null, error_summary: null });
    return { run: { ...prev, status: "running", finished_at: null }, resume: prev.cursor };
  }
  try { return { run: await store.createRun({ kind: plan.kind, source_label: plan.label, source_url: plan.url ?? null, watermark_t: plan.watermark }), resume: null }; }
  catch (e: any) { if (/off_one_running|duplicate key|unique/i.test(String(e?.message))) throw new SyncBusyError("Ya hay una sincronización en curso: no se ejecutan dos a la vez."); throw e; }
}

export async function syncOnce(d: SyncDeps, plan: Plan): Promise<Run> {
  const { store, cfg } = d, now = d.now ?? Date.now, iso = () => new Date(now()).toISOString();
  const { run, resume } = await begin(d, plan);
  const t: Totals = { rows_read: run.rows_read, processed: run.processed, inserted: run.inserted, updated: run.updated, unchanged: run.unchanged, rejected: run.rejected, errors: run.errors };
  let issues = 0, saved: Totals = { ...t }, savedCursor: Run["cursor"] = resume;   // lo último que quedó guardado junto con su posición: si falla, se reanuda desde ahí sin contar dos veces
  const origin = plan.kind === "full" ? "bulk" : "delta";

  async function flush(batch: OffRecord[], cursor: Run["cursor"]) {
    if (!batch.length) return;
    const byGtin = new Map<string, OffRecord>();
    for (const r of batch) { const cur = byGtin.get(r.gtin14); if (!cur || ts(r.off_last_modified_at) >= ts(cur.off_last_modified_at)) byGtin.set(r.gtin14, r); }
    const dups = batch.length - byGtin.size, ex = await store.existing([...byGtin.keys()]), at = iso();
    const ins: OffRow[] = [], upd: OffRow[] = [], same: string[] = [];
    for (const [g, rec] of byGtin) {
      const row: OffRow = { ...rec, origin, last_seen_at: at, last_seen_run: run.id, first_run: run.id, updated_at: at };
      if (!ex.has(g)) ins.push(row); else if (ts(rec.off_last_modified_at) > ts(ex.get(g))) upd.push(row); else same.push(g);
    }
    await store.insertProducts(ins); await store.updateProducts(upd); await store.touch(run.id, same);
    t.inserted += ins.length; t.updated += upd.length; t.unchanged += same.length + dups;
    await store.updateRun(run.id, { ...t, cursor }); saved = { ...t }; savedCursor = cursor;
  }
  try {
    let started = !resume?.file;
    for (const src of plan.sources) {
      const id = src.file ?? src.label;
      if (!started) { if (id !== resume!.file) continue; started = true; }
      const skipTo = resume?.file === id ? resume.line ?? 0 : 0;
      let batch: OffRecord[] = [], lastLine = skipTo;
      for await (const item of src.iterate()) {
        if (item.line <= skipTo) continue;
        if (item.malformed || !item.raw) { t.errors++; if (issues++ < MAX_ISSUES) await store.addIssues(run.id, [{ code: "", reason: item.malformed ?? "fila ilegible" }]); lastLine = item.line; continue; }
        t.processed++;
        const n = normalizeRaw(item.raw, cfg.fields);
        if (!n.ok) { t.rejected++; if (issues++ < MAX_ISSUES) await store.addIssues(run.id, [{ code: n.code, reason: n.reason }]); lastLine = item.line; continue; }
        batch.push(n.rec); lastLine = item.line;
        if (batch.length >= cfg.batchSize) { await flush(batch, { file: id, line: lastLine }); batch = []; }
      }
      await flush(batch, { file: id, line: lastLine });
      t.rows_read += Math.max(0, src.stats().read - skipTo);
    }
    if (plan.kind === "full" && t.processed === 0) throw new Error("El archivo no trae ningún producto de Argentina: es probable que Open Food Facts haya cambiado el formato.");
    const prior = plan.kind === "full" ? await store.latestRun("full", ["completed"]) : null;
    await store.updateRun(run.id, { ...t, status: "completed", finished_at: iso(), cursor: null, watermark_t: plan.watermark, error_summary: null });
    if (prior && prior.processed >= 100 && t.processed < prior.processed * 0.9) await raise(d, "count_drop", `La cantidad de productos de Argentina bajó de ${prior.processed} a ${t.processed}.`, { before: prior.processed, now: t.processed });
    if (t.processed >= 100 && t.rejected / t.processed > 0.1) await raise(d, "validation_errors", `Se rechazó el ${Math.round((t.rejected / t.processed) * 100)} % de los registros (${t.rejected} de ${t.processed}) por no pasar la validación.`, { rejected: t.rejected, processed: t.processed });
    return (await store.getRun(run.id))!;
  } catch (e: any) {
    await store.updateRun(run.id, { ...saved, cursor: savedCursor, status: "failed", finished_at: iso(), error_summary: String(e?.message ?? e).slice(0, 500) });
    await raise(d, "import_failed", `La sincronización de Open Food Facts falló: ${String(e?.message ?? e).slice(0, 200)}`);
    throw e;
  }
}
