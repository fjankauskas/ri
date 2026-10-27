// Cálculo de importes e IVA de una venta. Código puro (sin Node) para usarlo igual en el navegador y en el servidor.
export type Iva = "0" | "2.5" | "5" | "10.5" | "21" | "27" | "EX" | "NG";
export const IVA_OPTIONS: { key: Iva; label: string; id?: number; rate?: number }[] = [
  { key: "21", label: "IVA 21 %", id: 5, rate: 21 }, { key: "10.5", label: "IVA 10,5 %", id: 4, rate: 10.5 }, { key: "27", label: "IVA 27 %", id: 6, rate: 27 },
  { key: "5", label: "IVA 5 %", id: 8, rate: 5 }, { key: "2.5", label: "IVA 2,5 %", id: 9, rate: 2.5 }, { key: "0", label: "IVA 0 % (gravado)", id: 3, rate: 0 },
  { key: "EX", label: "Exento" }, { key: "NG", label: "No gravado" },
];
export type Emisor = "RI" | "MONO" | "EXENTO";
export type Line = { qty: number; unit_price: number; iva: string };
export type Alic = { id: number; rate: number; base: number; importe: number };
export type Totals = { neto: number; iva: number; totConc: number; opEx: number; total: number; alic: Alic[] };
export const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * Responsable Inscripto (facturas A/B): agrupa el neto por alícuota; exento → ImpOpEx; no gravado → ImpTotConc.
 * Monotributo / Exento (factura C): no se discrimina IVA; todo es subtotal (ImpNeto) y ImpTotal = ImpNeto.
 */
export function computeTotals(lines: Line[], emisor: Emisor = "RI"): Totals {
  const groups = new Map<string, number>();
  let totConc = 0, opEx = 0, neto = 0;
  for (const l of lines) {
    const net = r2(l.qty * l.unit_price);
    if (emisor !== "RI") { neto += net; continue; }
    if (l.iva === "EX") opEx += net;
    else if (l.iva === "NG") totConc += net;
    else groups.set(l.iva, (groups.get(l.iva) ?? 0) + net);
  }
  const alic: Alic[] = [];
  if (emisor === "RI") {
    for (const [k, base] of groups) {
      const opt = IVA_OPTIONS.find((o) => o.key === k);
      if (!opt || opt.id == null || opt.rate == null) throw new Error(`Alícuota de IVA desconocida: ${k}`);
      const b = r2(base);
      alic.push({ id: opt.id, rate: opt.rate, base: b, importe: r2((b * opt.rate) / 100) });
    }
    alic.sort((a, b) => a.id - b.id);
    neto = alic.reduce((s, a) => s + a.base, 0);
  }
  const iva = r2(alic.reduce((s, a) => s + a.importe, 0));
  neto = r2(neto); totConc = r2(totConc); opEx = r2(opEx);
  return { neto, iva, totConc, opEx, total: r2(neto + iva + totConc + opEx), alic };
}

export const COND_IVA: Record<number, string> = { 1: "IVA Responsable Inscripto", 4: "IVA Sujeto Exento", 5: "Consumidor Final", 6: "Responsable Monotributo", 7: "Sujeto No Categorizado", 8: "Proveedor del Exterior", 9: "Cliente del Exterior", 10: "IVA Liberado – Ley 19.640", 13: "Monotributista Social", 15: "IVA No Alcanzado", 16: "Monotributo Trabajador Independiente Promovido" };
export const DOC_TIPO: Record<number, string> = { 80: "CUIT", 86: "CUIL", 96: "DNI", 99: "Sin identificar" };
export const EMISOR_LABEL: Record<Emisor, string> = { RI: "Responsable Inscripto", MONO: "Monotributista", EXENTO: "IVA Sujeto Exento" };
export const CBTE: Record<number, string> = { 1: "Factura A", 2: "Nota de Débito A", 3: "Nota de Crédito A", 6: "Factura B", 7: "Nota de Débito B", 8: "Nota de Crédito B", 11: "Factura C", 12: "Nota de Débito C", 13: "Nota de Crédito C" };
export const pad = (n: number | string, w: number) => String(n).padStart(w, "0");
export const cbteNumber = (pv: number, nro: number | string) => `${pad(pv, 5)}-${pad(nro, 8)}`;

/**
 * Tipo de comprobante según quién emite y la condición IVA del receptor.
 * RI → receptor RI o monotributista: A; el resto: B. Monotributo/Exento → C.
 */
export function pickCbte(emisor: Emisor, receptorIva: number, kind: "INVOICE" | "CREDIT_NOTE"): { tipo: number; clase: "A" | "B" | "C" } {
  const clase = emisor !== "RI" ? "C" : [1, 6, 13, 16].includes(receptorIva) ? "A" : "B";
  const base = { A: 1, B: 6, C: 11 }[clase];
  return { clase, tipo: kind === "INVOICE" ? base : base + 2 };
}
