import Link from "next/link";
import Alert from "@/components/Alert";
import { Card } from "@/components/ui";
import { rank, summary, type Line, type SortBy } from "@/lib/reports";
import { money, n } from "@/lib/format";
import { Filters, Kpi, loadSales, pct } from "./shared";
import type { View, ViewCtx } from "@/lib/view";

function Bars({ items, by }: { items: Line[]; by: SortBy }) {
  const val = (l: Line) => (by === "margin" ? Math.max(l.margin ?? 0, 0) : by === "revenue" ? l.revenue : l.qty), max = Math.max(...items.map(val), 1);
  return (
    <ul className="grid gap-3">
      {items.map((l) => (
        <li key={l.id}>
          <div className="flex items-baseline justify-between gap-3 text-sm"><Link href={`/inventory?v=products&id=${l.id}`} className="truncate font-medium text-ink no-underline hover:text-accent">{l.name}</Link>
            <span className="shrink-0 text-mute">{n(l.qty)} {l.unit} · {money(l.revenue)}{l.margin != null ? ` · margen ${money(l.margin)}` : ""}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (val(l) / max) * 100)}%` }} /></div>
        </li>
      ))}
      {!items.length && <li className="text-sm text-mute">Sin ventas en el período.</li>}
    </ul>
  );
}
export default async function SalesReport({ sb, org, P }: ViewCtx): Promise<View> {
  const d = await loadSales(sb, org.id, P), by = (["revenue", "margin"].includes(P.by ?? "") ? P.by : "qty") as SortBy, sm = summary(d.lines);
  const top = rank(d.lines, by, "desc", 10), bottom = rank(d.lines, by, "asc", 10);
  const q = new URLSearchParams({ report: "sales", d: P.d ?? "30", ...(P.c ? { c: P.c } : {}) }).toString();
  const main = (
    <div className="grid gap-6">
      {d.error && <Alert tone="danger" title="No se pudo armar el reporte">{d.error}. ¿Ejecutaste la migración 0009?</Alert>}
      <Filters base="/reports" v="sales" P={P} by />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Productos con ventas" value={sm.products} hint={`${d.from.split("-").reverse().join("/")} al ${d.to.split("-").reverse().join("/")}`} />
        <Kpi label="Ingresos netos" value={money(sm.revenue)} hint="Sin IVA" />
        <Kpi label="Margen estimado" value={money(sm.margin)} hint={sm.marginPct != null ? `${pct(sm.marginPct)} sobre lo que tiene costo` : "Cargá costos para calcularlo"} />
        <Kpi label="Productos sin costo" value={sm.withoutCost} hint={sm.withoutCost ? "No entran en el margen" : "Todos tienen costo"} />
      </div>
      {sm.withoutCost > 0 && <Alert tone="warning" title="Falta el costo de algunos productos">El margen solo se calcula con productos que tienen costo. Se completa solo al recibir compras, o podés cargarlo a mano en Inventario → editar producto.</Alert>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Más vendidos"><Bars items={top} by={by} /></Card>
        <Card title="Menos vendidos" sub="Entre los productos que sí se vendieron. Los que no se movieron están en «Sin movimiento»."><Bars items={bottom} by={by} /></Card>
      </div>
    </div>
  );
  const aside = (
    <>
      <Card title="Acciones"><div className="grid gap-2"><a href={`/api/reports/export?${q}`} className="btn btn-green no-underline">Descargar CSV</a><Link href="/reports?v=idle" className="btn btn-gray no-underline">Ver productos sin movimiento</Link><Link href="/reports?v=margin" className="btn btn-gray no-underline">Ver margen por producto</Link></div></Card>
      <Card title="Cómo se calcula"><ul className="grid gap-2 text-sm text-mute"><li><b>Consumidores:</b> ventas registradas, a su precio neto real.</li><li><b>Red:</b> mercadería enviada a empresas conectadas, valuada a tu precio de lista actual (estimado).</li><li><b>Costo:</b> costo promedio ponderado de tus compras recibidas.</li></ul></Card>
    </>
  );
  return { title: "Más y menos vendidos", intro: "Qué se mueve más y qué menos, entre las ventas a consumidores y lo que enviás a tu red.", main, aside };
}
