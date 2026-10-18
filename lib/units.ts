// Unidades de medida permitidas (lista cerrada). Los alias cubren lo que suele traer un Excel.
export const UNITS = ["u", "kg", "g", "l", "ml", "m", "caja", "pack", "bolsa", "docena"] as const;
const ALIAS: Record<string, string> = { un: "u", unidad: "u", unidades: "u", kilo: "kg", kilos: "kg", gr: "g", gramo: "g", gramos: "g", lt: "l", litro: "l", litros: "l", cajas: "caja", bolsas: "bolsa", packs: "pack", docenas: "docena" };
/** Devuelve la unidad válida equivalente o null si no es una de la lista. */
export function normUnit(x: string): string | null {
  const v = x.trim().toLowerCase();
  const u = ALIAS[v] ?? v;
  return (UNITS as readonly string[]).includes(u) ? u : null;
}
