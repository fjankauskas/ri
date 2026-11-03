// Cálculo de reportes de ventas, rotación y margen. Código puro (se prueba sin base de datos).
export type SalesRow = { product_id: string; name: string; sku: string; unit: string; qty_consumer: number | string; rev_consumer: number | string; qty_network: number | string; rev_network: number | string; avg_cost: number | string | null };
export type Channel = "all" | "consumer" | "network";
export type Line = { id: string; name: string; sku: string; unit: string; qty: number; qtyConsumer: number; qtyNetwork: number; revenue: number; cost: number | null; margin: number | null; marginPct: number | null };
const n = (x: number | string | null | undefined) => (x == null ? 0 : Number(x));
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Una línea por producto con cantidades, ingreso, costo y margen estimados, según el canal elegido. */
export function salesLines(rows: SalesRow[], channel: Channel = "all"): Line[] {
  return rows.map((r) => {
    const qc = n(r.qty_consumer), qn = n(r.qty_network), rc = n(r.rev_consumer), rn = n(r.rev_network);
    const qty = channel === "consumer" ? qc : channel === "network" ? qn : qc + qn, revenue = channel === "consumer" ? rc : channel === "network" ? rn : rc + rn;
    const cost = r.avg_cost == null ? null : r2(qty * n(r.avg_cost)), margin = cost == null ? null : r2(revenue - cost);
    return { id: r.product_id, name: r.name, sku: r.sku, unit: r.unit, qty, qtyConsumer: qc, qtyNetwork: qn, revenue: r2(revenue), cost, margin, marginPct: margin != null && revenue > 0 ? margin / revenue : null };
  }).filter((l) => l.qty > 0);
}
export type SortBy = "qty" | "revenue" | "margin";
const key = (l: Line, by: SortBy) => (by === "margin" ? l.margin ?? -Infinity : by === "revenue" ? l.revenue : l.qty);
/** Ranking: «desc» = más vendidos, «asc» = menos vendidos (entre los que tuvieron ventas). */
export function rank(lines: Line[], by: SortBy, dir: "desc" | "asc", limit = 10): Line[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...lines].sort((a, b) => sign * (key(a, by) - key(b, by)) || sign * (a.revenue - b.revenue) || a.name.localeCompare(b.name)).slice(0, limit);
}
export function summary(lines: Line[]) {
  const withCost = lines.filter((l) => l.margin != null), revenue = r2(lines.reduce((a, l) => a + l.revenue, 0)), margin = r2(withCost.reduce((a, l) => a + (l.margin as number), 0));
  const revWithCost = withCost.reduce((a, l) => a + l.revenue, 0);
  return { products: lines.length, revenue, margin, marginPct: revWithCost > 0 ? margin / revWithCost : null, withoutCost: lines.length - withCost.length };
}

export type IdleRow = { product_id: string; name: string; sku: string; unit: string; stock: number | string; last_move: string | null; avg_cost: number | string | null };
export type IdleLine = { id: string; name: string; sku: string; unit: string; stock: number; lastMove: string | null; days: number | null; value: number | null };
/** Productos con stock y sin salidas: días sin movimiento (null = nunca tuvieron salidas) y valor inmovilizado a costo. */
export function idleLines(rows: IdleRow[], now = new Date()): IdleLine[] {
  return rows.map((r) => ({ id: r.product_id, name: r.name, sku: r.sku, unit: r.unit, stock: n(r.stock), lastMove: r.last_move, days: r.last_move ? Math.floor((now.getTime() - new Date(r.last_move).getTime()) / 864e5) : null, value: r.avg_cost == null ? null : r2(n(r.stock) * n(r.avg_cost)) }))
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity) || (b.value ?? 0) - (a.value ?? 0));
}
export const idleValue = (l: IdleLine[]) => r2(l.reduce((a, x) => a + (x.value ?? 0), 0));

const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (headers: string[], rows: unknown[][]) => "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.map(cell).join(";"))].join("\r\n") + "\r\n";
export const periods: [string, string, number][] = [["7", "Últimos 7 días", 7], ["30", "Últimos 30 días", 30], ["90", "Últimos 90 días", 90], ["365", "Último año", 365]];
/** Rango de fechas (AAAA-MM-DD, hora de Argentina) para los últimos N días. */
export function rangeLastDays(days: number, now = new Date()): { from: string; to: string } {
  const f = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return { from: f(new Date(now.getTime() - (days - 1) * 864e5)), to: f(now) };
}
