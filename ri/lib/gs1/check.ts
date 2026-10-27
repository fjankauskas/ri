// Dígito de control GS1 (módulo 10) y validación de claves. Código puro: sirve en el navegador y en el servidor.
export const isDigits = (s: string) => /^\d+$/.test(s);
/** Dígito de control GS1: se suman los dígitos de derecha a izquierda con pesos 3,1,3,1… */
export function checkDigit(body: string): number {
  if (!isDigits(body)) throw new Error("El cuerpo de la clave debe tener solo dígitos");
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}
export const withCheck = (body: string) => body + checkDigit(body);
export const validCheck = (code: string) => isDigits(code) && code.length >= 2 && checkDigit(code.slice(0, -1)) === Number(code[code.length - 1]);

export type GtinKind = "GTIN-8" | "GTIN-12" | "GTIN-13" | "GTIN-14";
const GTIN_KIND: Record<number, GtinKind> = { 8: "GTIN-8", 12: "GTIN-12", 13: "GTIN-13", 14: "GTIN-14" };
export const gtinKind = (code: string): GtinKind | null => (isDigits(code) ? GTIN_KIND[code.length] ?? null : null);
export const toGtin14 = (code: string) => code.padStart(14, "0");
/** GTIN-14 → forma más corta equivalente (13, 12 u 8 dígitos) cuando el indicador es 0. */
export const fromGtin14 = (g14: string) => (g14.startsWith("00000") && g14.length === 14 ? g14.slice(6) : g14.startsWith("0") ? g14.slice(1) : g14);

export type GtinCheck = { ok: boolean; kind?: GtinKind; gtin14?: string; error?: string };
export function validateGtin(input: string): GtinCheck {
  const code = input.replace(/[\s-]/g, "");
  if (!code) return { ok: false, error: "Ingresá un código" };
  if (!isDigits(code)) return { ok: false, error: "El GTIN solo lleva dígitos (0–9)" };
  const kind = gtinKind(code);
  if (!kind) return { ok: false, error: `Un GTIN tiene 8, 12, 13 o 14 dígitos (este tiene ${code.length})` };
  if (!validCheck(code)) return { ok: false, kind, error: `El dígito de control no coincide: debería ser ${checkDigit(code.slice(0, -1))}` };
  return { ok: true, kind, gtin14: toGtin14(code) };
}

/** Longitud de cada clave GS1 (incluye el dígito de control). */
export const KEY_LENGTH = { GLN: 13, SSCC: 18, GSIN: 17, GSRN: 18, GDTI: 13, GCN: 13, GRAI: 14 } as const;
export type KeyName = keyof typeof KEY_LENGTH;
export function validateKey(kind: KeyName, code: string): { ok: boolean; error?: string } {
  const c = code.replace(/[\s-]/g, "");
  if (!isDigits(c) || c.length !== KEY_LENGTH[kind]) return { ok: false, error: `${kind} lleva ${KEY_LENGTH[kind]} dígitos` };
  return validCheck(c) ? { ok: true } : { ok: false, error: `El dígito de control no coincide: debería ser ${checkDigit(c.slice(0, -1))}` };
}
