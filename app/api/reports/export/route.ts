import { NextResponse } from "next/server";
import { ctx } from "@/lib/ctx";
import { idleLines, rangeLastDays, periods, rank, salesLines, toCsv, type Channel, type IdleRow, type SalesRow } from "@/lib/reports";
// CSV de reportes: ?report=sales|margin|idle|network&d=30&c=all&k=90
export async function GET(req: Request) {
  const { sb, org } = await ctx(); const u = new URL(req.url), report = u.searchParams.get("report") ?? "sales";
  const days = periods.find(([k]) => k === u.searchParams.get("d"))?.[2] ?? 30, { from, to } = rangeLastDays(days), c = (["consumer", "network"].includes(u.searchParams.get("c") ?? "") ? u.searchParams.get("c") : "all") as Channel;
  const done = (name: string, body: string) => new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  const fail = (m: string) => NextResponse.json({ error: m }, { status: 400 });
  if (report === "idle") {
    const k = Number(u.searchParams.get("k")) || 90, { data, error } = await sb.rpc("report_idle", { p_org: org.id, p_days: k }); if (error) return fail(error.message);
    return done("sin-movimiento", toCsv(["Producto", "SKU", "Unidad", "Stock", "Última salida", "Días sin salida", "Valor a costo"], idleLines((data as IdleRow[]) ?? []).map((l) => [l.name, l.sku, l.unit, l.stock, l.lastMove?.slice(0, 10) ?? "Nunca", l.days ?? "", l.value ?? ""])));
  }
  if (report === "network") {
    const { data, error } = await sb.rpc("report_network", { p_org: org.id, p_from: from, p_to: to }); if (error) return fail(error.message);
    return done("comercio-red", toCsv(["Empresa", "Enviado (valor estimado)", "Recibido (valor estimado)", "Envíos"], ((data as any[]) ?? []).map((r) => [r.partner, r.sent_value, r.received_value, r.shipments])));
  }
  const { data, error } = await sb.rpc("report_sales", { p_org: org.id, p_from: from, p_to: to }); if (error) return fail(error.message);
  const lines = rank(salesLines((data as SalesRow[]) ?? [], report === "margin" ? c : c), report === "margin" ? "margin" : "qty", "desc", 5000);
  return done(report === "margin" ? "margen" : "ventas", toCsv(["Producto", "SKU", "Unidad", "Unidades", "Ingreso neto", "Costo total", "Margen", "Margen %"], lines.map((l) => [l.name, l.sku, l.unit, l.qty, l.revenue, l.cost ?? "", l.margin ?? "", l.marginPct != null ? (l.marginPct * 100).toFixed(1) : ""])));
}
