import { validCheck, checkDigit } from "./check";
// Identificadores de aplicación (AI) de GS1: lectura, validación y armado de cadenas de elementos (HRI y FNC1).
const GS = "\x1d";
type Part = { t: "N" | "X"; n: number; v: boolean };
export type AIDef = { ai: string; title: string; name: string; parts: Part[]; min: number; max: number; check?: number; date?: "d6" | "dt10" | "d6-12" | "p8-12"; unit?: string; dec?: boolean };

function spec(s: string): { parts: Part[]; min: number; max: number } {
  const parts = s.split("+").map((p): Part => { const m = /^([NX])(\.\.)?(\d+)$/.exec(p)!; return { t: m[1] as "N" | "X", n: Number(m[3]), v: !!m[2] }; });
  return { parts, min: parts.reduce((a, p) => a + (p.v ? 0 : p.n), 0), max: parts.reduce((a, p) => a + p.n, 0) };
}
const DEFS: AIDef[] = [];
const add = (ai: string, title: string, name: string, s: string, extra: Partial<AIDef> = {}) => {
  const sp = spec(s.replace(/^N(\d+)\.\.(\d+)$/, (_m, a, b) => `N${a}+N..${Number(b) - Number(a)}`));  // "N6..12" = 6 dígitos mínimo, 12 máximo
  DEFS.push({ ai, title, name, ...sp, ...extra });
};
add("00", "SSCC", "Código de unidad logística (SSCC)", "N18", { check: 18 });
add("01", "GTIN", "GTIN del artículo comercial", "N14", { check: 14 });
add("02", "CONTENT", "GTIN de los artículos contenidos", "N14", { check: 14 });
add("10", "BATCH/LOT", "Lote o partida", "X..20");
add("11", "PROD DATE", "Fecha de producción", "N6", { date: "d6" });
add("12", "DUE DATE", "Fecha de vencimiento de pago", "N6", { date: "d6" });
add("13", "PACK DATE", "Fecha de envasado", "N6", { date: "d6" });
add("15", "BEST BEFORE", "Consumir preferentemente antes de", "N6", { date: "d6" });
add("16", "SELL BY", "Fecha límite de venta", "N6", { date: "d6" });
add("17", "USE BY OR EXPIRY", "Fecha de vencimiento", "N6", { date: "d6" });
add("20", "VARIANT", "Variante interna del producto", "N2");
add("21", "SERIAL", "Número de serie", "X..20");
add("22", "CPV", "Variante de producto del consumidor (CPV)", "X..20");
add("235", "TPX", "Extensión de producto de terceros", "X..28");
add("240", "ADDITIONAL ID", "Identificación adicional del producto", "X..30");
add("241", "CUST. PART NO.", "Código de parte del cliente", "X..30");
add("242", "MTO VARIANT", "Variante de fabricación a pedido", "N..6");
add("243", "PCN", "Número de componente de empaque", "X..20");
add("250", "SECONDARY SERIAL", "Número de serie secundario", "X..30");
add("251", "REF. TO SOURCE", "Referencia a la entidad de origen", "X..30");
add("253", "GDTI", "Tipo de documento (GDTI)", "N13+X..17", { check: 13 });
add("254", "GLN EXTENSION", "Extensión del GLN", "X..20");
add("255", "GCN", "Cupón global (GCN)", "N13+N..12", { check: 13 });
add("30", "VAR. COUNT", "Cantidad variable de unidades", "N..8");
add("37", "COUNT", "Cantidad de unidades contenidas", "N..8");
const MEASURES: Record<string, [string, string]> = {
  "310": ["Peso neto", "kg"], "311": ["Largo", "m"], "312": ["Ancho", "m"], "313": ["Alto", "m"], "314": ["Superficie", "m²"], "315": ["Volumen neto", "l"], "316": ["Volumen neto", "m³"],
  "320": ["Peso neto", "lb"], "321": ["Largo", "in"], "322": ["Largo", "ft"], "323": ["Largo", "yd"], "324": ["Ancho", "in"], "325": ["Ancho", "ft"], "326": ["Ancho", "yd"], "327": ["Alto", "in"], "328": ["Alto", "ft"], "329": ["Alto", "yd"],
  "330": ["Peso logístico", "kg"], "331": ["Largo logístico", "m"], "332": ["Ancho logístico", "m"], "333": ["Alto logístico", "m"], "334": ["Superficie logística", "m²"], "335": ["Volumen logístico", "l"], "336": ["Volumen logístico", "m³"], "337": ["Kg por m²", "kg/m²"],
  "340": ["Peso logístico", "lb"], "341": ["Largo logístico", "in"], "342": ["Largo logístico", "ft"], "343": ["Largo logístico", "yd"], "344": ["Ancho logístico", "in"], "345": ["Ancho logístico", "ft"], "346": ["Ancho logístico", "yd"], "347": ["Alto logístico", "in"], "348": ["Alto logístico", "ft"], "349": ["Alto logístico", "yd"],
  "350": ["Superficie", "in²"], "351": ["Superficie", "ft²"], "352": ["Superficie", "yd²"], "353": ["Superficie logística", "in²"], "354": ["Superficie logística", "ft²"], "355": ["Superficie logística", "yd²"], "356": ["Peso neto", "oz troy"], "357": ["Volumen neto", "oz"],
  "360": ["Volumen neto", "qt"], "361": ["Volumen neto", "gal"], "362": ["Volumen logístico", "qt"], "363": ["Volumen logístico", "gal"], "364": ["Volumen neto", "in³"], "365": ["Volumen neto", "ft³"], "366": ["Volumen neto", "yd³"], "367": ["Volumen logístico", "in³"], "368": ["Volumen logístico", "ft³"], "369": ["Volumen logístico", "yd³"],
};
for (const [p, [name, unit]] of Object.entries(MEASURES)) for (let d = 0; d < 10; d++) add(`${p}${d}`, "MEASURE", `${name} (${unit})`, "N6", { unit, dec: true });
for (let d = 0; d < 10; d++) {
  add(`390${d}`, "AMOUNT", "Importe a pagar (moneda local)", "N..15", { dec: true });
  add(`391${d}`, "AMOUNT", "Importe a pagar con moneda ISO", "N3+N..15", { dec: true });
  add(`392${d}`, "PRICE", "Precio por unidad de medida variable", "N..15", { dec: true });
  add(`393${d}`, "PRICE", "Precio con moneda ISO", "N3+N..15", { dec: true });
  add(`394${d}`, "PRCNT OFF", "Porcentaje de descuento", "N4", { dec: true });
  add(`395${d}`, "PRICE/UoM", "Precio por unidad de medida", "N6", { dec: true });
}
add("400", "ORDER NUMBER", "Número de orden del cliente", "X..30");
add("401", "GINC", "Identificación de envío consolidado (GINC)", "X..30");
add("402", "GSIN", "Identificación de envío (GSIN)", "N17", { check: 17 });
add("403", "ROUTE", "Código de ruta", "X..30");
for (const [ai, t, n] of [["410", "SHIP TO LOC", "Enviar a (GLN)"], ["411", "BILL TO", "Facturar a (GLN)"], ["412", "PURCHASE FROM", "Comprado a (GLN)"], ["413", "SHIP FOR LOC", "Enviar para (GLN)"], ["414", "LOC No", "Ubicación física (GLN)"], ["415", "PAY TO", "Pagar a (GLN)"], ["416", "PROD/SERV LOC", "Ubicación de producción o servicio (GLN)"], ["417", "PARTY", "Parte (GLN)"]]) add(ai, t, n, "N13", { check: 13 });
add("420", "SHIP TO POST", "Código postal de destino", "X..20");
add("421", "SHIP TO POST", "Código postal de destino con país ISO", "N3+X..9");
add("422", "ORIGIN", "País de origen (ISO 3166)", "N3");
add("423", "COUNTRY - INITIAL PROCESS.", "País de procesamiento inicial", "N3+N..12");
add("424", "COUNTRY - PROCESS.", "País de procesamiento", "N3");
add("425", "COUNTRY - DISASSEMBLY", "País de desarme", "N3+N..12");
add("426", "COUNTRY - FULL PROCESS", "País de procesamiento completo", "N3");
add("427", "ORIGIN SUBDIVISION", "Subdivisión de origen", "X..3");
add("7001", "NSN", "Número de stock OTAN", "N13");
add("7002", "MEAT CUT", "Corte de carne (UN/ECE)", "X..30");
add("7003", "EXPIRY TIME", "Fecha y hora de vencimiento", "N10", { date: "dt10" });
add("7004", "ACTIVE POTENCY", "Potencia activa", "N..4");
add("7005", "CATCH AREA", "Zona de captura", "X..12");
add("7006", "FIRST FREEZE DATE", "Fecha de primer congelado", "N6", { date: "d6" });
add("7007", "HARVEST DATE", "Fecha de cosecha", "N6..12", { date: "d6-12" });
add("7008", "AQUATIC SPECIES", "Especie acuática", "X..3");
add("7009", "FISHING GEAR TYPE", "Arte de pesca", "X..10");
add("7010", "PROD METHOD", "Método de producción", "X..2");
add("7020", "REFURB LOT", "Lote de reacondicionamiento", "X..20");
add("7021", "FUNC STAT", "Estado funcional", "X..20");
add("7022", "REV STAT", "Estado de revisión", "X..20");
add("7023", "GIAI - ASSEMBLY", "GIAI de ensamblado", "X..30");
for (let s = 0; s < 10; s++) add(`703${s}`, "PROCESSOR # s", "Aprobación del procesador (país + número)", "N3+X..27");
for (const [ai, n] of [["710", "PZN (Alemania)"], ["711", "CIP (Francia)"], ["712", "CNK (Bélgica)"], ["713", "DRN (Brasil)"], ["714", "AIM (Portugal)"], ["715", "NDC (EE. UU.)"]]) add(ai, "NHRN", `Número nacional de producto de salud ${n}`, "X..20");
for (let s = 0; s < 10; s++) add(`723${s}`, "CERT # s", "Número de certificación", "X2+X..28");
add("7240", "PROTOCOL", "Protocolo", "X..20");
add("8001", "DIMENSIONS", "Dimensiones del producto (rollos)", "N14");
add("8002", "CMT No", "Número de teléfono móvil", "X..20");
add("8003", "GRAI", "Activo retornable (GRAI)", "N14+X..16", { check: 14 });
add("8004", "GIAI", "Activo individual (GIAI)", "X..30");
add("8005", "PRICE PER UNIT", "Precio por unidad", "N6");
add("8006", "ITIP", "Pieza individual de un artículo (ITIP)", "N18", { check: 14 });
add("8007", "IBAN", "Cuenta bancaria internacional (IBAN)", "X..34");
add("8008", "PROD TIME", "Fecha y hora de producción", "N8..12", { date: "p8-12" });
add("8009", "OPTSEN", "Datos de sensores ópticos", "X..50");
add("8010", "CPID", "Identificador de componente/parte (CPID)", "X..30");
add("8011", "CPID SERIAL", "Serie del CPID", "N..12");
add("8012", "VERSION", "Versión de software", "X..20");
add("8013", "GMN", "Número de modelo global (GMN)", "X..25");
add("8017", "GSRN - PROVIDER", "GSRN del proveedor del servicio", "N18", { check: 18 });
add("8018", "GSRN - RECIPIENT", "GSRN del receptor del servicio", "N18", { check: 18 });
add("8019", "SRIN", "Instancia de relación de servicio", "N..10");
add("8020", "REF NO", "Número de referencia de pago", "X..25");
add("8026", "ITIP CONTENT", "ITIP de los artículos contenidos", "N18", { check: 14 });
add("8110", "COUPON CODE", "Cupón (código de Norteamérica)", "X..70");
add("8111", "POINTS", "Puntos de fidelidad", "N4", { dec: true });
add("8112", "COUPON CODE", "Cupón sin papel", "X..70");
add("8200", "PRODUCT URL", "URL extendida del producto", "X..70");
add("90", "INTERNAL", "Información entre socios comerciales", "X..30");
for (let i = 91; i <= 99; i++) add(String(i), "INTERNAL", "Información interna de la empresa", "X..90");

const BY_AI = new Map(DEFS.map((d) => [d.ai, d]));
export const AI_TABLE = DEFS;
export const aiDef = (ai: string) => BY_AI.get(ai);
/** Largo del AI según sus dos primeros dígitos (regla del estándar). */
function aiLength(first2: string): number {
  const n = Number(first2);
  if ([0, 1, 2, 10, 11, 12, 13, 15, 16, 17, 20, 21, 22, 30, 37].includes(n) || (n >= 90 && n <= 99)) return 2;
  if (n === 23 || n === 24 || n === 25 || n === 71 || (n >= 40 && n <= 43)) return 3;
  if ((n >= 31 && n <= 36) || n === 39 || n === 70 || n === 72 || (n >= 80 && n <= 82)) return 4;
  return 0;
}
// AI cuyo largo está predefinido: no necesitan separador FNC1 detrás (GS1 General Specifications, tabla de AI de largo fijo predefinido).
const PREDEFINED = (ai: string) => ["00", "01", "02", "03", "04", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"].includes(ai) || /^3[1-6]/.test(ai) || /^41[0-7]$/.test(ai);

const CSET82 = /^[A-Za-z0-9!"%&'()*+,\-./:;<=>?_ ]*$/, DIGITS = /^\d*$/;
const yearOf = (yy: number, now = new Date()) => { const base = now.getFullYear(), century = Math.floor(base / 100) * 100; let y = century + yy; if (y - base > 50) y -= 100; else if (base - y >= 50) y += 100; return y; };
export function dateValue(v: string, kind: AIDef["date"]): { ok: boolean; iso?: string } {
  const yy = Number(v.slice(0, 2)), mm = Number(v.slice(2, 4)), dd = Number(v.slice(4, 6)), y = yearOf(yy);
  if (mm < 1 || mm > 12) return { ok: false };
  const dim = new Date(y, mm, 0).getDate();
  if (dd > dim) return { ok: false };
  if (kind === "dt10" || kind === "p8-12") { const hh = Number(v.slice(6, 8)); if (hh > 23) return { ok: false }; if (v.length >= 10 && Number(v.slice(8, 10)) > 59) return { ok: false }; if (v.length >= 12 && Number(v.slice(10, 12)) > 59) return { ok: false }; }
  if (kind === "d6-12" && v.length > 6) { const e = dateValue(v.slice(6), "d6"); if (!e.ok) return { ok: false }; }
  return { ok: true, iso: `${y}-${String(mm).padStart(2, "0")}-${dd === 0 ? "00" : String(dd).padStart(2, "0")}` };
}

export type Element = { ai: string; value: string; def?: AIDef; errors: string[]; display?: string };
function validateElement(ai: string, value: string): Element {
  const def = BY_AI.get(ai), errors: string[] = [];
  if (!def) return { ai, value, errors: [`El AI (${ai}) no existe en el estándar GS1`] };
  if (value.length < def.min) errors.push(`(${ai}) necesita al menos ${def.min} caracteres (tiene ${value.length})`);
  if (value.length > def.max) errors.push(`(${ai}) admite hasta ${def.max} caracteres (tiene ${value.length})`);
  let pos = 0;
  for (const p of def.parts) {
    const seg = value.slice(pos, pos + p.n); pos += seg.length;
    if (p.t === "N" ? !DIGITS.test(seg) : !CSET82.test(seg)) errors.push(p.t === "N" ? `(${ai}) debe tener solo dígitos` : `(${ai}) tiene caracteres no permitidos`);
    if (!p.v && seg.length < p.n) break;
  }
  if (def.check && value.length >= def.check && DIGITS.test(value.slice(0, def.check)) && !validCheck(value.slice(0, def.check))) errors.push(`(${ai}) el dígito de control no coincide: debería ser ${checkDigit(value.slice(0, def.check - 1))}`);
  let display: string | undefined;
  if (def.date && DIGITS.test(value) && !errors.length) { const d = dateValue(value, def.date); if (!d.ok) errors.push(`(${ai}) no es una fecha válida (AAMMDD)`); else display = d.iso!.endsWith("-00") ? d.iso!.slice(0, 7) + " (sin día)" : d.iso; }
  if (def.dec && DIGITS.test(value) && !errors.length) {
    const n = Number(ai[ai.length - 1]), raw = def.parts.length > 1 ? value.slice(3) : value;
    const num = Number(raw) / 10 ** n; display = `${num.toLocaleString("es-AR", { minimumFractionDigits: n, maximumFractionDigits: n })}${def.unit ? " " + def.unit : ""}${def.parts.length > 1 ? ` (moneda ISO ${value.slice(0, 3)})` : ""}`;
  }
  if (ai === "01" || ai === "02") if (!errors.length) display = value.replace(/^0+(?=\d{8})/, "");
  return { ai, value, def, errors, display };
}

export type Parsed = { elements: Element[]; errors: string[]; symbology?: string; ok: boolean };
const SYMID: Record<string, string> = { "]C1": "GS1-128", "]d2": "GS1 DataMatrix", "]Q3": "GS1 QR Code", "]e0": "GS1 DataBar", "]E0": "EAN/UPC", "]E4": "EAN-8", "]I1": "ITF-14", "]J1": "GS1 DotCode" };
/** Interpreta una cadena de elementos: con paréntesis «(01)…(10)…» o cruda con separador FNC1 (GS, 0x1D) y/o identificador de simbología «]C1». */
export function parseElementString(input: string): Parsed {
  let s = input.trim(), symbology: string | undefined;
  const sym = /^\](..)/.exec(s); if (sym) { symbology = SYMID["]" + sym[1]] ?? "]" + sym[1]; s = s.slice(3); }
  const out: Parsed = { elements: [], errors: [], symbology, ok: false };
  s = s.replace(/[\u2402\u241d]/g, GS);
  if (!s) { out.errors.push("Cadena vacía"); return out; }
  if (s.includes("(")) {
    const re = /\((\d{2,4})\)([^(]*)/g; let m: RegExpExecArray | null, consumed = 0;
    while ((m = re.exec(s))) { if (m.index !== consumed) break; consumed = m.index + m[0].length; out.elements.push(validateElement(m[1], m[2].replace(new RegExp(`${GS}+$`), ""))); }
    if (consumed !== s.length || !out.elements.length) out.errors.push("El formato con paréntesis no es válido; ejemplo: (01)07791234567893(17)271231(10)LOTE1");
  } else {
    let i = 0;
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      const len = aiLength(s.slice(i, i + 2)), ai = len ? s.slice(i, i + len) : "";
      const def = ai ? BY_AI.get(ai) : undefined;
      if (!def) { out.errors.push(`No se reconoce un identificador de aplicación en «${s.slice(i, i + 4)}…»`); break; }
      i += len;
      let end: number;
      if (def.min === def.max) end = i + def.max;
      else { const g = s.indexOf(GS, i); end = g === -1 ? Math.min(s.length, i + def.max) : Math.min(g, i + def.max); }
      if (def.min !== def.max && end - i === def.max && s[end] !== GS && end < s.length) { /* campo variable que llegó al máximo sin separador */ }
      const value = s.slice(i, end); out.elements.push(validateElement(ai, value)); i = end;
    }
  }
  const seen = new Set<string>();
  for (const e of out.elements) { if (seen.has(e.ai)) out.errors.push(`El AI (${e.ai}) aparece más de una vez`); seen.add(e.ai); out.errors.push(...e.errors); }
  const has = (a: string) => seen.has(a);
  if (has("02") && !has("37")) out.errors.push("El AI (02) debe ir acompañado de la cantidad (37)");
  if (has("01") && has("02")) out.errors.push("No se pueden usar a la vez (01) y (02) para identificar el contenido");
  out.ok = !out.errors.length && out.elements.length > 0;
  return out;
}

/** Arma la cadena de elementos. «hri» = texto legible con paréntesis; «raw» = datos del código con GS (FNC1) entre campos variables. */
export function buildElementString(items: { ai: string; value: string }[], format: "hri" | "raw" = "hri"): string {
  const list = items.filter((i) => i.value !== "");
  if (format === "hri") return list.map((i) => `(${i.ai})${i.value}`).join("");
  return list.map((i, k) => `${i.ai}${i.value}${k < list.length - 1 && !(PREDEFINED(i.ai) && BY_AI.get(i.ai)?.min === BY_AI.get(i.ai)?.max) ? GS : ""}`).join("");
}
export const hriFromRaw = (raw: string) => { const p = parseElementString(raw); return p.ok ? buildElementString(p.elements, "hri") : null; };
export const FNC1_GS = GS;
