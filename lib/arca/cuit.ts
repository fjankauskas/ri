/** Valida un CUIT/CUIL argentino (11 dígitos + dígito verificador módulo 11). */
export function isValidCuit(input: string): boolean {
  const d = input.replace(/\D/g, "");
  if (d.length !== 11) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
  let v = 11 - (sum % 11); if (v === 11) v = 0; if (v === 10) v = 9;
  return v === Number(d[10]);
}
export const cleanCuit = (s: string) => s.replace(/\D/g, "");
