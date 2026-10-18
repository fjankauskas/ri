// Lectura de CSV de carga de stock. Tolera lo que exporta Excel en español:
// separador ";" o ",", decimales con coma, fechas DD/MM/AAAA, BOM y comillas.
export type StockRow = { line: number; sku: string; lot: string; qty: number; expires: string | null; name: string | null; unit: string | null };

const ALIASES: Record<"sku" | "lot" | "qty" | "expires" | "name" | "unit", string[]> = {
  sku: ["sku", "codigo", "cod", "code", "articulo", "item"],
  lot: ["lote", "lot", "batch", "nro lote", "numero de lote", "n lote"],
  qty: ["cantidad", "qty", "cant", "quantity", "stock", "unidades"],
  expires: ["vencimiento", "vence", "fecha vencimiento", "expires", "expiration", "caducidad", "fecha de vencimiento"],
  name: ["nombre", "producto", "descripcion", "name", "description"],
  unit: ["unidad", "unit", "um", "unidad de medida"],
};
type Field = keyof typeof ALIASES;
const ORDER: Field[] = ["sku", "lot", "qty", "expires", "name", "unit"];
export const MAX_ROWS = 2000;

const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_\-.]+/g, " ").trim();

export function parseTable(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, "");
  const first = t.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const count = (c: string) => { let n = 0, q = false; for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch === c) n++; } return n; };
  const delim = [";", "\t", ","].map((c) => [c, count(c)] as const).sort((a, b) => b[1] - a[1])[0];
  const d = delim[1] > 0 ? delim[0] : ",";
  const out: string[][] = []; let row: string[] = [], cell = "", q = false;
  const endCell = () => { row.push(cell.trim()); cell = ""; };
  const endRow = () => { endCell(); if (row.some((c) => c !== "")) out.push(row); row = []; };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"' && cell === "") q = true;
    else if (ch === d) endCell();
    else if (ch === "\n") endRow();
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) endRow();
  return out;
}

export function parseQty(raw: string): number {
  let x = raw.replace(/\s/g, "");
  if (!/^[0-9.,]+$/.test(x)) return NaN;
  if (x.includes(".") && x.includes(",")) {
    const dec = x.lastIndexOf(",") > x.lastIndexOf(".") ? "," : ".";
    x = dec === "," ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, "");
  } else if (x.includes(",")) {
    if (x.split(",").length > 2) x = x.replace(/,/g, ""); else x = x.replace(",", ".");
  } else if ((x.match(/\./g) ?? []).length > 1) x = x.replace(/\./g, "");
  else if (/^[1-9]\d{0,2}\.\d{3}$/.test(x)) return NaN; // "1.500": ambiguo (¿1,5 o 1500?), se pide aclararlo
  return Number(x);
}

export function parseDate(raw: string): string | null | undefined {
  const x = raw.trim(); if (!x) return null;
  let m = x.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/), y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = x.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return undefined;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseStockCsv(text: string): StockRow[] {
  const table = parseTable(text);
  if (!table.length) throw new Error("El archivo no tiene filas");
  const head = table[0].map(norm);
  const found = (f: Field) => head.findIndex((h) => ALIASES[f].includes(h));
  const hasHeader = ["sku", "lot", "qty"].some((f) => found(f as Field) >= 0);
  const col: Record<Field, number> = { sku: 0, lot: 1, qty: 2, expires: 3, name: 4, unit: 5 };
  if (hasHeader) {
    for (const f of ORDER) col[f] = found(f);
    const missing = (["sku", "lot", "qty"] as Field[]).filter((f) => col[f] < 0);
    if (missing.length) throw new Error(`Faltan columnas obligatorias: ${missing.map((f) => ({ sku: "sku", lot: "lote", qty: "cantidad" }[f as "sku"])).join(", ")}. Encabezados leídos: ${table[0].join(" | ")}`);
  }
  const body = hasHeader ? table.slice(1) : table;
  if (!body.length) throw new Error("El archivo solo tiene encabezados, no hay filas para importar");
  if (body.length > MAX_ROWS) throw new Error(`Máximo ${MAX_ROWS} filas por importación (el archivo tiene ${body.length}). Dividilo en partes.`);
  const get = (r: string[], f: Field) => (col[f] >= 0 ? r[col[f]] ?? "" : "").trim();
  const errors: string[] = [];
  const rows: StockRow[] = body.map((r, i) => {
    const line = i + 1 + (hasHeader ? 1 : 0);
    const sku = get(r, "sku"), lot = get(r, "lot"), qty = parseQty(get(r, "qty")), expires = parseDate(get(r, "expires"));
    if (!sku) errors.push(`fila ${line}: falta el SKU`);
    else if (!lot) errors.push(`fila ${line}: falta el lote`);
    else if (!(qty > 0)) errors.push(`fila ${line}: cantidad inválida "${get(r, "qty")}" (debe ser un número mayor que 0; usá coma para decimales y sin separador de miles)`);
    else if (expires === undefined) errors.push(`fila ${line}: vencimiento inválido "${get(r, "expires")}" (usá AAAA-MM-DD o DD/MM/AAAA)`);
    return { line, sku, lot, qty, expires: expires ?? null, name: get(r, "name") || null, unit: get(r, "unit") || null };
  });
  if (errors.length) throw new Error(`No se importó nada. Corregí el archivo: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? `; y ${errors.length - 5} errores más` : ""}`);
  return rows;
}
