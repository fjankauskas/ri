import { gtinKind, toGtin14, validateGtin, type GtinKind } from "../gs1/check";
import { DEFAULT_FIELDS, type Field } from "./config";
// Validación y normalización de los registros de OFF: solo se conservan los campos permitidos.
export type OffRecord = {
  code: string; gtin14: string; gtin_kind: GtinKind; product_name: string | null; generic_name: string | null; brands: string | null; quantity: string | null;
  countries_tags: string[]; in_argentina: boolean; off_last_modified_at: string | null;
};
export type Normalized = { ok: true; rec: OffRecord } | { ok: false; code: string; reason: string };
const clean = (v: unknown, max: number): string | null => { if (v == null) return null; const s = String(v).replace(/\s+/g, " ").trim(); return s ? s.slice(0, max) : null; };
export const ARGENTINA_TAG = "en:argentina";
/** Etiquetas de país: lista separada por comas (CSV) o arreglo (JSON). */
export function countryTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return list.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
}
export const isArgentina = (v: unknown) => countryTags(v).includes(ARGENTINA_TAG);
export function normalizeRaw(raw: Record<string, unknown>, fields: readonly Field[] = DEFAULT_FIELDS): Normalized {
  const code = String(raw.code ?? "").trim();
  if (!/^\d+$/.test(code)) return { ok: false, code, reason: code ? "código no numérico" : "sin código" };
  const v = validateGtin(code);
  if (!v.ok) return { ok: false, code, reason: `GTIN inválido: ${v.error}` };
  const use = (f: Field, max: number) => (fields.includes(f) ? clean(raw[f], max) : null);
  const rec: OffRecord = {
    code, gtin14: toGtin14(code), gtin_kind: gtinKind(code)!, product_name: use("product_name", 300), generic_name: use("generic_name", 300), brands: use("brands", 300), quantity: use("quantity", 100),
    countries_tags: countryTags(raw.countries_tags).slice(0, 40), in_argentina: isArgentina(raw.countries_tags),
    off_last_modified_at: Number(raw.last_modified_t) > 0 ? new Date(Number(raw.last_modified_t) * 1000).toISOString() : null,
  };
  if (!rec.product_name && !rec.generic_name && !rec.brands) return { ok: false, code, reason: "sin nombre, nombre genérico ni marca" };
  return { ok: true, rec };
}
/** Nombre para mostrar: nombre comercial, o el genérico, o la marca. */
export const displayName = (r: { product_name: string | null; generic_name: string | null; brands: string | null }) => r.product_name ?? r.generic_name ?? r.brands ?? "";
/** Nombre sugerido para crear un producto: nombre + marca (si no está repetida) + cantidad. */
export function suggestedName(r: { product_name: string | null; generic_name: string | null; brands: string | null; quantity: string | null }): string {
  const base = displayName(r), brand = (r.brands ?? "").split(",")[0].trim(), low = base.toLowerCase();
  const parts = [base, brand && !low.includes(brand.toLowerCase()) ? brand : "", r.quantity && !low.includes(r.quantity.toLowerCase()) ? r.quantity : ""].filter(Boolean);
  return parts.join(" ").slice(0, 120);
}
// «500 g», «1,5 L», «750ml», «6 x 330 ml» → cantidad y unidad (código UN/CEFACT de la ficha GS1 y unidad de la app).
const UNIT: Record<string, [string, string]> = { g: ["GRM", "g"], gr: ["GRM", "g"], grs: ["GRM", "g"], kg: ["KGM", "kg"], kgs: ["KGM", "kg"], l: ["LTR", "l"], lt: ["LTR", "l"], lts: ["LTR", "l"], ml: ["MLT", "ml"], cl: ["MLT", "ml"], un: ["C62", "u"], u: ["C62", "u"], unidades: ["C62", "u"] };
export function parseQuantity(q: string | null): { value: number; uom: string; unit: string } | null {
  if (!q) return null;
  const m = /^\s*(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)\s*$/.exec(q); if (!m) return null;
  const unitKey = m[3].toLowerCase(), u = UNIT[unitKey]; if (!u) return null;
  let value = Number(m[2].replace(",", ".")) * (m[1] ? Number(m[1]) : 1); if (unitKey === "cl") value *= 10;
  return Number.isFinite(value) && value > 0 ? { value: Math.round(value * 1000) / 1000, uom: u[0], unit: u[1] } : null;
}
