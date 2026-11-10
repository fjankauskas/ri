/**
 * Sincronización del catálogo de Open Food Facts (productos asociados a Argentina).
 *
 *   npx tsx scripts/off-sync.ts auto     decide solo: importación completa o cambios diarios
 *   npx tsx scripts/off-sync.ts full     importación completa desde el CSV oficial
 *   npx tsx scripts/off-sync.ts delta    solo los cambios de los últimos días (archivos delta oficiales)
 *   npx tsx scripts/off-sync.ts check    verifica qué exportaciones existen y cuánto pesan (no importa nada)
 *   npx tsx scripts/off-sync.ts status   estado del catálogo, últimas ejecuciones y alertas
 *
 * Usa SUPABASE_SERVICE_ROLE_KEY y la URL de Supabase de tu .env.local, y OFF_CONTACT_EMAIL para el User-Agent.
 * Open Food Facts pide no recorrer su base con la API: por eso la carga masiva usa sus exportaciones oficiales.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { configFromEnv, userAgent, NO_CONTACT_MESSAGE } from "../lib/off/config";
import { supabaseStore } from "../lib/off/store";
import { csvSource, jsonlSource, parseDeltaIndex, planDelta, type RecordSource } from "../lib/off/export";
import { openLines } from "../lib/off/stream";
import { webhook } from "../lib/off/notify";
import { decideMode, syncOnce, SyncBusyError, type Plan } from "../lib/off/sync";

// Lee .env.local si las variables no están definidas (para correrlo a mano en tu PC).
for (const file of [".env.local", ".env"]) if (existsSync(file)) for (const l of readFileSync(file, "utf8").split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const cfg = configFromEnv(), ua = userAgent(cfg);
const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const mb = (n: number | null) => (n ? `${(n / 1048576).toFixed(0)} MB` : "tamaño desconocido");

async function head(url: string) {
  try { const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": ua ?? "RedDeInventario/1.0" } }); return { ok: r.ok, status: r.status, bytes: Number(r.headers.get("content-length")) || null, modified: r.headers.get("last-modified") }; }
  catch (e: any) { return { ok: false, status: 0, bytes: null, modified: null, error: e?.message as string }; }
}
async function check() {
  log("Verificando las exportaciones (no se descarga nada).");
  const cands: [string, string][] = [["CSV global (carga completa)", cfg.csvUrl], ["Índice de archivos delta", cfg.deltaIndexUrl], ["CSV propio de Argentina (¿existe?)", "https://ar.openfoodfacts.org/data/ar.openfoodfacts.org.products.csv.gz"]];
  for (const [name, url] of cands) { const r = await head(url); log(`${r.ok ? "✔" : "✖"} ${name}: ${r.ok ? `HTTP ${r.status}, ${mb(r.bytes)}, modificado ${r.modified ?? "?"}` : `no disponible (${r.error ?? "HTTP " + r.status})`}\n    ${url}`); }
  try { const t = await (await fetch(cfg.deltaIndexUrl, { headers: { "User-Agent": ua ?? "RedDeInventario/1.0" } })).text(), f = parseDeltaIndex(t, cfg.deltaBaseUrl); log(`Delta: ${f.length} archivos${f.length ? `, desde ${new Date(f[0].from * 1000).toISOString().slice(0, 10)} hasta ${new Date(f[f.length - 1].to * 1000).toISOString().slice(0, 10)}` : ""}.`); } catch (e: any) { log("No se pudo leer el índice delta:", e?.message); }
  log("Si existiera un CSV filtrado por país, se usa con OFF_EXPORT_CSV_URL; mientras tanto se filtra Argentina localmente sobre el CSV global.");
}
const progress = (lines: AsyncIterable<string>, label: string): AsyncIterable<string> => (async function* () { let n = 0; for await (const l of lines) { if (++n % 500_000 === 0) log(`  ${label}: ${n.toLocaleString("es-AR")} filas leídas…`); yield l; } })();

async function fullPlan(): Promise<Plan> {
  const h = await head(cfg.csvUrl), watermark = h.modified ? Math.floor(Date.parse(h.modified) / 1000) : Math.floor(Date.now() / 1000) - 36 * 3600;
  log(`Importación completa desde ${cfg.csvUrl} (${mb(h.bytes)}, generado ${h.modified ?? "fecha desconocida"}). Se procesa en streaming: puede tardar varios minutos.`);
  const src: RecordSource = csvSource("CSV oficial", () => (async function* () { const o = await openLines(cfg.csvUrl, ua!); yield* progress(o.lines, "CSV"); })(), { file: "csv" });
  return { kind: "full", label: "CSV oficial de Open Food Facts (filtrado a Argentina)", url: cfg.csvUrl, watermark, sources: [src] };
}
async function deltaPlan(watermark: number | null): Promise<Plan | { needFull: string }> {
  const idx = await fetch(cfg.deltaIndexUrl, { headers: { "User-Agent": ua! } }); if (!idx.ok) throw new Error(`No se pudo leer el índice delta (HTTP ${idx.status}).`);
  const files = parseDeltaIndex(await idx.text(), cfg.deltaBaseUrl), p = planDelta(files, watermark);
  if (p.needFull) return { needFull: p.reason ?? "los delta no alcanzan" };
  log(p.files.length ? `Cambios diarios: ${p.files.length} archivo(s) delta.` : "No hay archivos delta nuevos: el catálogo está al día.");
  const sources = p.files.map((f) => jsonlSource(f.name, () => (async function* () { const o = await openLines(f.url, ua!); yield* o.lines; })(), { file: f.name, to: f.to }));
  return { kind: "delta", label: `Archivos delta (${p.files.length})`, url: cfg.deltaIndexUrl, watermark: p.files.length ? Math.max(...p.files.map((f) => f.to)) : watermark, sources };
}

async function main() {
  const cmd = process.argv[2] ?? "auto";
  if (cmd === "check") return check();
  if (!SB_URL || !SB_KEY) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.");
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } }), store = supabaseStore(sb);
  if (cmd === "status") {
    const c = await store.counts(); log(`Catálogo: ${c.total} productos (${c.argentina} asociados a Argentina).`);
    for (const r of ((await sb.from("off_import_runs").select("*").order("started_at", { ascending: false }).limit(5)).data as any[]) ?? []) log(`  ${r.started_at.slice(0, 16)} ${r.kind} ${r.status} · nuevos ${r.inserted}, actualizados ${r.updated}, sin cambios ${r.unchanged}, rechazados ${r.rejected}${r.error_summary ? " · " + r.error_summary : ""}`);
    for (const a of ((await sb.from("off_alerts").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(5)).data as any[]) ?? []) log(`  ⚠ ${a.kind}: ${a.message}`);
    return;
  }
  if (!ua) throw new Error(NO_CONTACT_MESSAGE);
  const deps = { store, cfg, notify: (k: any, m: string) => webhook(cfg, k, m) };
  let mode: "full" | "delta";
  if (cmd === "full" || cmd === "delta") mode = cmd;
  else if (cmd === "auto") { const d = decideMode({ completed: await store.latestRun("any", ["completed"]), fullCompleted: await store.latestRun("full", ["completed"]) }, Date.now(), cfg); log(`Modo automático: ${d.mode === "full" ? "importación completa" : "cambios diarios"} (${d.reason}).`); mode = d.mode; }
  else throw new Error(`Comando desconocido: ${cmd}. Usá auto, full, delta, check o status.`);
  let plan: Plan | { needFull: string };
  if (mode === "delta") { const last = await store.latestRun("any", ["completed"]); plan = await deltaPlan(last?.watermark_t ?? null); if ("needFull" in plan) { log(`No alcanza con los delta (${plan.needFull}): se hace una importación completa.`); plan = await fullPlan(); } }
  else plan = await fullPlan();
  const run = await syncOnce(deps, plan as Plan);
  log(`✔ Sincronización completada. Procesados ${run.processed} · nuevos ${run.inserted} · actualizados ${run.updated} · sin cambios ${run.unchanged} · rechazados ${run.rejected} · errores ${run.errors}.`);
}
main().catch((e) => { if (e instanceof SyncBusyError) { log("⏸", e.message); process.exit(0); } console.error("✖", e?.message ?? e); process.exit(1); });
