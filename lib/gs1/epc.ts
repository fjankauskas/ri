// Identificadores EPC (URN) y Digital Link para EPCIS. Necesitan saber cuántos dígitos tiene el prefijo de empresa (GCP).
const SAFE = /[A-Za-z0-9!'()*+,\-.:;=_]/;
/** Escapa lote/serie para URN EPC (se permiten letras, dígitos y !'()*+,-.:;=_). */
export const epcEscape = (s: string) => Array.from(s).map((c) => (SAFE.test(c) ? c : encodeURIComponent(c))).join("");
const cp = (code: string, from: number, len: number) => code.slice(from, from + len);
export function sgtinUrn(gtin14: string, serial: string, cpLen: number) {
  return `urn:epc:id:sgtin:${cp(gtin14, 1, cpLen)}.${gtin14[0]}${gtin14.slice(1 + cpLen, 13)}.${epcEscape(serial)}`;
}
/** Clase de lote (LGTIN): identifica un GTIN + lote sin serie individual. */
export function lgtinUrn(gtin14: string, lot: string, cpLen: number) {
  return `urn:epc:class:lgtin:${cp(gtin14, 1, cpLen)}.${gtin14[0]}${gtin14.slice(1 + cpLen, 13)}.${epcEscape(lot)}`;
}
export function ssccUrn(sscc: string, cpLen: number) { return `urn:epc:id:sscc:${cp(sscc, 1, cpLen)}.${sscc[0]}${sscc.slice(1 + cpLen, 17)}`; }
export function sglnUrn(gln: string, cpLen: number, ext = "0") { return `urn:epc:id:sgln:${cp(gln, 0, cpLen)}.${gln.slice(cpLen, 12)}.${ext}`; }
export const gtinDigitalLink = (gtin14: string, lot?: string) => `https://id.gs1.org/01/${gtin14}${lot ? `/10/${encodeURIComponent(lot)}` : ""}`;
export const glnDigitalLink = (gln: string) => `https://id.gs1.org/414/${gln}`;
