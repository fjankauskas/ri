import { checkDigit, isDigits, withCheck } from "./check";
// Construcción de claves GS1 a partir del prefijo de empresa (GCP) asignado por GS1 Argentina y un número de referencia propio.
const pad = (n: number | bigint | string, w: number) => String(n).padStart(w, "0");
export function checkPrefix(prefix: string) {
  if (!isDigits(prefix) || prefix.length < 6 || prefix.length > 12) throw new Error("El prefijo de empresa GS1 tiene entre 6 y 12 dígitos");
}
/** Cantidad de referencias disponibles según el largo del prefijo y del cuerpo de la clave (sin dígito de control). */
export const capacity = (prefix: string, bodyLength: number) => 10 ** (bodyLength - prefix.length);

/** GTIN-13: prefijo + referencia de artículo (completada con ceros) + dígito de control. */
export function gtin13(prefix: string, itemRef: number | string): string {
  checkPrefix(prefix);
  const w = 12 - prefix.length; if (w < 1) throw new Error("El prefijo es demasiado largo para un GTIN-13");
  const ref = String(itemRef); if (!isDigits(ref) || ref.length > w) throw new Error(`La referencia de artículo admite hasta ${w} dígitos con este prefijo`);
  return withCheck(prefix + pad(ref, w));
}
/** GTIN-14 de un nivel de empaque: indicador 1–8 + los 12 primeros dígitos del GTIN base + dígito de control. */
export function gtin14(indicator: number, baseGtin: string): string {
  if (!Number.isInteger(indicator) || indicator < 1 || indicator > 9) throw new Error("El indicador de empaque va de 1 a 9 (9 = medida variable)");
  const base = baseGtin.padStart(14, "0").slice(1, 13);
  return withCheck(`${indicator}${base}`);
}
/** GTIN-13 de distribución restringida (uso interno, rango 20–29): no identifica a la empresa ante terceros. */
export const internalGtin13 = (seq: number) => { if (seq < 0 || seq > 9_999_999_999) throw new Error("Secuencia fuera de rango"); return withCheck(`20${pad(seq, 10)}`); };
/** EAN-13 de medida variable (balanza): 2 + PLU(6) + peso en gramos o importe en centavos(5) + dígito de control. Formato interno, sin validez comercial externa. */
export function variableMeasureEan13(plu: number | string, value: number): string {
  const p = String(plu); if (!isDigits(p) || p.length > 6) throw new Error("El PLU admite hasta 6 dígitos");
  if (!Number.isInteger(value) || value < 0 || value > 99999) throw new Error("El peso (g) o importe (centavos) admite hasta 5 dígitos");
  return withCheck(`2${pad(p, 6)}${pad(value, 5)}`);
}
/** GLN (identifica empresas y ubicaciones): prefijo + referencia de ubicación + dígito de control (13 dígitos). */
export function gln(prefix: string, locRef: number | string): string {
  checkPrefix(prefix);
  const w = 12 - prefix.length; if (w < 0) throw new Error("El prefijo es demasiado largo para un GLN");
  const ref = String(locRef); if (w === 0 ? ref !== "" && ref !== "0" : !isDigits(ref) || ref.length > w) throw new Error(`La referencia de ubicación admite hasta ${w} dígitos con este prefijo`);
  return withCheck(prefix + (w ? pad(ref, w) : ""));
}
/** SSCC (unidad logística): dígito de extensión + prefijo + referencia seriada + dígito de control (18 dígitos). */
export function sscc(extension: number, prefix: string, serialRef: number | bigint | string): string {
  checkPrefix(prefix);
  if (!Number.isInteger(extension) || extension < 0 || extension > 9) throw new Error("El dígito de extensión va de 0 a 9");
  const w = 16 - prefix.length, ref = String(serialRef); if (!isDigits(ref) || ref.length > w) throw new Error(`La referencia del SSCC admite hasta ${w} dígitos con este prefijo`);
  return withCheck(`${extension}${prefix}${pad(ref, w)}`);
}
/** Claves menores con la misma regla (prefijo + referencia + control). */
export function keyWithRef(prefix: string, ref: number | string, totalLength: number, label: string): string {
  checkPrefix(prefix);
  const w = totalLength - 1 - prefix.length, r = String(ref);
  if (w < 1 || !isDigits(r) || r.length > w) throw new Error(`${label}: la referencia admite hasta ${Math.max(w, 0)} dígitos con este prefijo`);
  return withCheck(prefix + pad(r, w));
}
export const gsrn = (prefix: string, ref: number | string) => keyWithRef(prefix, ref, 18, "GSRN");
export const gsin = (prefix: string, ref: number | string) => keyWithRef(prefix, ref, 17, "GSIN");
export const gdti = (prefix: string, docType: number | string) => keyWithRef(prefix, docType, 13, "GDTI");
export const gcn = (prefix: string, couponRef: number | string) => keyWithRef(prefix, couponRef, 13, "GCN");
/** GRAI (AI 8003): "0" + prefijo + tipo de activo retornable + control (14 dígitos), con serie opcional de hasta 16 caracteres. */
export const grai = (prefix: string, assetType: number | string, serial = "") => { if (serial.length > 16) throw new Error("La serie del GRAI admite hasta 16 caracteres"); return "0" + keyWithRef(prefix, assetType, 13, "GRAI") + serial; };
/** GIAI (AI 8004): prefijo + referencia de activo individual (alfanumérica, hasta 30 caracteres en total). */
export const giai = (prefix: string, assetRef: string) => { checkPrefix(prefix); if (!/^[A-Za-z0-9\-\/]+$/.test(assetRef) || prefix.length + assetRef.length > 30) throw new Error("El GIAI admite hasta 30 caracteres alfanuméricos en total"); return prefix + assetRef; };
export { checkDigit };
