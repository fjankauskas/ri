import { aiDef, buildElementString, parseElementString, type Element } from "./ai";
// GS1 Digital Link: el mismo identificador del código de barras expresado como una URL (para códigos QR y resolvedores).
const PRIMARY = ["01", "8006", "8013", "414", "253", "255", "00", "8003", "8004", "402", "401", "8010", "8017", "8018", "417", "8019"];
const QUALIFIERS: Record<string, string[]> = { "01": ["22", "10", "21"], "8006": ["22", "10", "21"], "414": ["254"], "8010": ["8011"] };
export const DL_BASE = "https://id.gs1.org";
const enc = (v: string) => encodeURIComponent(v);

export function toDigitalLink(items: { ai: string; value: string }[], base = DL_BASE): { url: string; errors: string[] } {
  const errors: string[] = [], map = new Map(items.filter((i) => i.value !== "").map((i) => [i.ai, i.value]));
  const key = PRIMARY.find((k) => map.has(k));
  if (!key) return { url: "", errors: ["Falta una clave de identificación (GTIN, SSCC, GLN, GRAI, GIAI…) para armar el Digital Link"] };
  let value = map.get(key)!; if (key === "01" || key === "02") value = value.padStart(14, "0");
  let path = `/${key}/${enc(value)}`; const used = new Set([key]);
  for (const q of QUALIFIERS[key] ?? []) if (map.has(q)) { path += `/${q}/${enc(map.get(q)!)}`; used.add(q); }
  const query = [...map.entries()].filter(([a]) => !used.has(a)).map(([a, v]) => `${a}=${enc(v)}`).join("&");
  return { url: `${base.replace(/\/$/, "")}${path}${query ? "?" + query : ""}`, errors };
}

/** Lee un Digital Link (URL) y devuelve los elementos. Acepta cualquier dominio de resolvedor. */
export function fromDigitalLink(input: string): { elements: Element[]; errors: string[]; ok: boolean } {
  let u: URL; try { u = new URL(input.trim()); } catch { return { elements: [], errors: ["No es una URL válida"], ok: false }; }
  const segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const at = segs.findIndex((s, i) => PRIMARY.includes(s) && segs[i + 1] !== undefined);
  if (at === -1) return { elements: [], errors: ["La URL no contiene una clave GS1 (por ejemplo /01/{GTIN})"], ok: false };
  const pairs: { ai: string; value: string }[] = [];
  for (let i = at; i + 1 < segs.length; i += 2) { if (!/^\d{2,4}$/.test(segs[i])) break; pairs.push({ ai: segs[i], value: segs[i + 1] }); }
  for (const [k, v] of u.searchParams) if (/^\d{2,4}$/.test(k) && aiDef(k)) pairs.push({ ai: k, value: v });
  const p = parseElementString(buildElementString(pairs, "hri"));
  return { elements: p.elements, errors: p.errors, ok: p.ok };
}
