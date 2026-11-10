import { isArgentina, ARGENTINA_TAG } from "./normalize";
// Lectura de las exportaciones oficiales de OFF (CSV con tabuladores y JSON por líneas): se filtra Argentina y se extraen solo los campos necesarios.
export type RawItem = { line: number; raw?: Record<string, unknown>; malformed?: string };
export type RecordSource = { label: string; file?: string; to?: number; iterate(): AsyncIterable<RawItem>; stats(): { read: number } };
export class FormatError extends Error {}
/** Copia independiente del texto: un fragmento cortado de una línea mantiene vivo todo el bloque descargado del que salió (se retendría casi todo el archivo). */
const detach = (v: unknown): any => (typeof v === "string" && typeof Buffer !== "undefined" ? Buffer.from(v, "utf8").toString("utf8") : v);
export const CSV_COLUMNS = ["code", "last_modified_t", "product_name", "generic_name", "quantity", "brands", "countries_tags"] as const;

/** CSV oficial de OFF: UTF-8, separado por tabuladores y sin comillas (los campos no se entrecomillan). */
export function csvSource(label: string, lines: () => AsyncIterable<string>, extra: Partial<RecordSource> = {}): RecordSource {
  let read = 0;
  return {
    label, ...extra, stats: () => ({ read }),
    async *iterate() {
      read = 0; let idx: Record<string, number> | null = null, width = 0, n = 0;
      for await (const lineRaw of lines()) {
        n++;
        const line = lineRaw.endsWith("\r") ? lineRaw.slice(0, -1) : lineRaw;
        if (n === 1) {
          const h = line.replace(/^\uFEFF/, "").split("\t"); width = h.length; idx = {};
          for (const c of CSV_COLUMNS) { const i = h.indexOf(c); if (i >= 0) idx[c] = i; }
          const missing = CSV_COLUMNS.filter((c) => idx![c] === undefined);
          if (missing.length) throw new FormatError(`El archivo no trae las columnas esperadas (faltan: ${missing.join(", ")}). Open Food Facts puede haber cambiado el formato.`);
          continue;
        }
        if (!line) continue;
        read++;
        const p = line.split("\t");
        if (p.length !== width) { yield { line: n, malformed: `fila con ${p.length} columnas en lugar de ${width}` }; continue; }
        const c = p[idx!.countries_tags];
        if (!c || !c.includes(ARGENTINA_TAG) || !isArgentina(c)) continue;
        yield { line: n, raw: { code: detach(p[idx!.code]), last_modified_t: detach(p[idx!.last_modified_t]), product_name: detach(p[idx!.product_name]), generic_name: detach(p[idx!.generic_name]), quantity: detach(p[idx!.quantity]), brands: detach(p[idx!.brands]), countries_tags: detach(c) } };
      }
    },
  };
}
/** Archivos delta de OFF: un documento JSON por línea. */
export function jsonlSource(label: string, lines: () => AsyncIterable<string>, extra: Partial<RecordSource> = {}): RecordSource {
  let read = 0;
  return {
    label, ...extra, stats: () => ({ read }),
    async *iterate() {
      read = 0; let n = 0, docs = 0;
      for await (const l of lines()) {
        n++; if (!l.trim()) continue; read++;
        if (l.includes('"code"')) docs++;
        if (!l.includes(ARGENTINA_TAG)) continue;
        let d: any; try { d = JSON.parse(l); } catch { yield { line: n, malformed: "línea que no es JSON válido" }; continue; }
        if (!isArgentina(d.countries_tags)) continue;
        yield { line: n, raw: { code: detach(d.code), last_modified_t: d.last_modified_t, product_name: detach(d.product_name), generic_name: detach(d.generic_name), quantity: detach(d.quantity), brands: detach(d.brands), countries_tags: d.countries_tags } };
      }
      if (read >= 50 && docs === 0) throw new FormatError("El archivo delta no tiene el formato esperado (un documento JSON por línea con el campo «code»). Open Food Facts puede haber cambiado el formato.");
    },
  };
}
export type DeltaFile = { name: string; url: string; from: number; to: number };
/** index.txt de los delta: un nombre de archivo por línea; el nombre trae el UNIX timestamp del primer y del último cambio. */
export function parseDeltaIndex(text: string, baseUrl: string): DeltaFile[] {
  const out: DeltaFile[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.trim(); const m = /_(\d{9,11})_(\d{9,11})\.json(?:\.gz)?$/.exec(name);
    if (m) out.push({ name, url: /^https?:/.test(name) ? name : baseUrl + name, from: Number(m[1]), to: Number(m[2]) });
  }
  return out.sort((a, b) => a.to - b.to);
}
/** Qué archivos delta hay que procesar según hasta dónde llegó la última sincronización. */
export function planDelta(files: DeltaFile[], watermark: number | null): { needFull: boolean; reason?: string; files: DeltaFile[] } {
  if (watermark == null) return { needFull: true, reason: "no hay una sincronización completa previa", files: [] };
  if (!files.length) return { needFull: true, reason: "el índice de archivos delta está vacío", files: [] };
  const newer = files.filter((f) => f.to > watermark);
  if (!newer.length) return { needFull: false, files: [] };
  if (watermark < Math.min(...files.map((f) => f.from)) - 3600) return { needFull: true, reason: "los cambios desde la última sincronización ya no están en los delta (solo se guardan 14 días)", files: [] };
  return { needFull: false, files: newer };
}
