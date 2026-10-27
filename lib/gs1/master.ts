import { toGtin14 } from "./check";
// Datos maestros de producto alineados al modelo de datos GS1 (subconjunto de atributos de GDSN usado en Argentina).
export type Master = {
  brand?: string | null; gpc_brick?: string | null; net_content?: number | null; net_content_uom?: string | null; gross_weight?: number | null; net_weight?: number | null; weight_uom?: string | null;
  height?: number | null; width?: number | null; depth?: number | null; dimension_uom?: string | null; origin_country?: string | null; target_market?: string | null; shelf_life_days?: number | null;
  storage_min_c?: number | null; storage_max_c?: number | null; product_url?: string | null; image_url?: string | null; description_long?: string | null;
};
/** Códigos UN/CEFACT (Recomendación 20) que usa GS1 para unidades de medida. */
export const UOM: Record<string, string> = { KGM: "kilogramo", GRM: "gramo", TNE: "tonelada", LTR: "litro", MLT: "mililitro", MTR: "metro", CMT: "centímetro", MMT: "milímetro", C62: "unidad", XBX: "caja", XPK: "paquete", XBG: "bolsa", DZN: "docena" };
export const WEIGHT_UOM = ["KGM", "GRM", "TNE"], DIM_UOM = ["CMT", "MMT", "MTR"], CONTENT_UOM = ["KGM", "GRM", "LTR", "MLT", "C62", "MTR", "CMT"];
export const UNIT_TO_UOM: Record<string, string> = { u: "C62", kg: "KGM", g: "GRM", l: "LTR", ml: "MLT", m: "MTR", caja: "XBX", pack: "XPK", bolsa: "XBG", docena: "DZN" };
export const COUNTRIES: [string, string][] = [["AR", "Argentina"], ["BR", "Brasil"], ["CL", "Chile"], ["UY", "Uruguay"], ["PY", "Paraguay"], ["BO", "Bolivia"], ["PE", "Perú"], ["CO", "Colombia"], ["EC", "Ecuador"], ["VE", "Venezuela"], ["MX", "México"], ["US", "Estados Unidos"], ["CA", "Canadá"], ["ES", "España"], ["IT", "Italia"], ["FR", "Francia"], ["DE", "Alemania"], ["PT", "Portugal"], ["GB", "Reino Unido"], ["NL", "Países Bajos"], ["BE", "Bélgica"], ["CH", "Suiza"], ["AT", "Austria"], ["CN", "China"], ["JP", "Japón"], ["KR", "Corea del Sur"], ["IN", "India"], ["TR", "Turquía"], ["ZA", "Sudáfrica"], ["AU", "Australia"], ["NZ", "Nueva Zelanda"], ["VN", "Vietnam"], ["TH", "Tailandia"], ["ID", "Indonesia"], ["PL", "Polonia"], ["SE", "Suecia"], ["DK", "Dinamarca"], ["NO", "Noruega"], ["FI", "Finlandia"], ["IE", "Irlanda"], ["GR", "Grecia"], ["CR", "Costa Rica"], ["PA", "Panamá"], ["DO", "República Dominicana"]];
/** Mercado objetivo = código numérico ISO 3166 (así lo pide GDSN). */
export const MARKETS: [string, string][] = [["032", "Argentina"], ["076", "Brasil"], ["152", "Chile"], ["858", "Uruguay"], ["600", "Paraguay"], ["068", "Bolivia"], ["604", "Perú"], ["170", "Colombia"], ["218", "Ecuador"], ["862", "Venezuela"], ["484", "México"], ["840", "Estados Unidos"], ["124", "Canadá"], ["724", "España"], ["380", "Italia"], ["250", "Francia"], ["276", "Alemania"], ["826", "Reino Unido"], ["156", "China"]];

type P = { gtin?: string | null; name: string };
const has = (v: unknown) => v !== null && v !== undefined && v !== "" && !(typeof v === "number" && Number.isNaN(v));
/** Qué tan completa está la ficha (0–100) y qué falta, con los atributos que exigen las plataformas de sincronización de datos. */
export function completeness(p: P, m: Master | null | undefined): { pct: number; missing: string[] } {
  const x = m ?? {};
  const checks: [string, boolean][] = [
    ["GTIN", has(p.gtin)], ["Descripción", has(p.name)], ["Marca", has(x.brand)], ["Clasificación GPC", has(x.gpc_brick)], ["Contenido neto", has(x.net_content) && has(x.net_content_uom)],
    ["Peso bruto", has(x.gross_weight)], ["Peso neto", has(x.net_weight)], ["Dimensiones", has(x.height) && has(x.width) && has(x.depth)], ["País de origen", has(x.origin_country)], ["Mercado objetivo", has(x.target_market)], ["Imagen", has(x.image_url)],
  ];
  const ok = checks.filter(([, v]) => v).length;
  return { pct: Math.round((ok / checks.length) * 100), missing: checks.filter(([, v]) => !v).map(([k]) => k) };
}

const qv = (value: number | null | undefined, unitCode: string | null | undefined) => (has(value) ? { "@type": "QuantitativeValue", value: Number(value), unitCode: unitCode || undefined } : undefined);
export type PackLevel = { gtin: string; level: string; units_per_pack: number; description?: string | null };
/** Ficha en JSON-LD (schema.org, el vocabulario con el que se alinea GS1 Web Vocabulary). */
export function productJsonLd(p: { gtin?: string | null; name: string; unit: string; sku: string }, m: Master | null, org: string, packs: PackLevel[], link?: string) {
  const x = m ?? {}, prop = (name: string, value: unknown) => (has(value) ? { "@type": "PropertyValue", name, value } : undefined);
  const doc: Record<string, unknown> = {
    "@context": "https://schema.org/", "@type": "Product", ...(link ? { "@id": link } : {}),
    ...(p.gtin ? { gtin: toGtin14(p.gtin) } : {}), sku: p.sku, name: p.name, ...(has(x.description_long) ? { description: x.description_long } : {}),
    ...(has(x.brand) ? { brand: { "@type": "Brand", name: x.brand } } : {}), ...(has(x.image_url) ? { image: x.image_url } : {}), ...(has(x.product_url) ? { url: x.product_url } : {}),
    ...(has(x.origin_country) ? { countryOfOrigin: { "@type": "Country", name: x.origin_country } } : {}),
    ...(qv(x.gross_weight, x.weight_uom) ? { weight: qv(x.gross_weight, x.weight_uom) } : {}), ...(qv(x.height, x.dimension_uom) ? { height: qv(x.height, x.dimension_uom) } : {}),
    ...(qv(x.width, x.dimension_uom) ? { width: qv(x.width, x.dimension_uom) } : {}), ...(qv(x.depth, x.dimension_uom) ? { depth: qv(x.depth, x.dimension_uom) } : {}),
    manufacturer: { "@type": "Organization", name: org },
    additionalProperty: [prop("Contenido neto", has(x.net_content) ? `${x.net_content} ${x.net_content_uom ?? ""}`.trim() : null), prop("Peso neto", has(x.net_weight) ? `${x.net_weight} ${x.weight_uom ?? ""}`.trim() : null), prop("GPC (brick)", x.gpc_brick), prop("Mercado objetivo (ISO 3166)", x.target_market), prop("Vida útil (días)", x.shelf_life_days), prop("Temperatura mínima de almacenamiento (°C)", x.storage_min_c), prop("Temperatura máxima de almacenamiento (°C)", x.storage_max_c),
      ...packs.map((k) => prop(`Presentación ${k.level} (${k.units_per_pack} u.)`, k.gtin))].filter(Boolean),
  };
  return doc;
}

export const CSV_HEADERS = ["GTIN", "SKU", "Descripción", "Marca", "GPC", "Contenido neto", "UM contenido", "Peso bruto", "Peso neto", "UM peso", "Alto", "Ancho", "Profundidad", "UM dimensión", "País de origen", "Mercado objetivo", "Vida útil (días)", "Temp. mín (°C)", "Temp. máx (°C)", "URL producto", "URL imagen", "Presentaciones (nivel:GTIN-14:unidades)"];
const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV (con BOM para Excel) con las columnas típicas para cargar fichas en una plataforma de datos maestros. */
export function productsCsv(rows: { p: { gtin?: string | null; sku: string; name: string }; m: Master | null; packs: PackLevel[] }[]): string {
  const lines = rows.map(({ p, m, packs }) => { const x = m ?? {}; return [p.gtin ? toGtin14(p.gtin) : "", p.sku, p.name, x.brand, x.gpc_brick, x.net_content, x.net_content_uom, x.gross_weight, x.net_weight, x.weight_uom, x.height, x.width, x.depth, x.dimension_uom, x.origin_country, x.target_market, x.shelf_life_days, x.storage_min_c, x.storage_max_c, x.product_url, x.image_url, packs.map((k) => `${k.level}:${k.gtin}:${k.units_per_pack}`).join(" | ")].map(cell).join(";"); });
  return "\uFEFF" + [CSV_HEADERS.join(";"), ...lines].join("\r\n") + "\r\n";
}
