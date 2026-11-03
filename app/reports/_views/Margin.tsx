import Link from "next/link";
import Alert from "@/components/Alert";
import { Card, Pill, Empty } from "@/components/ui";
import { rank, summary } from "@/lib/reports";
import { money, n } from "@/lib/format";
import { Filters, Kpi, loadSales, pct } from "./shared";
import type { View, ViewCtx } from "@/lib/view";

export default async function MarginReport({ sb, org, P }: ViewCtx): Promise<View> {
  const d = await loadSales(sb, org.id, P), sm = summary(d.lines), sorted = rank(d.lines, "margin", "desc", 500), q = new URLSearchParams({ report: "margin", d: P.d ?? "30", ...(P.c ? { c: P.c } : {}) }).toString();
  const main = (
    <div className="grid gap-6">
      {d.error && <Alert tone="danger" title="No se pudo armar el reporte">{d.error}. ¿Ejecutaste la migración 0009?</Alert>}
      <Filters base="/reports" v="margin" P={P} />
      <div className="grid gap-4 sm:grid-cols-3"><Kpi label="Ingresos netos" value={money(sm.revenue)} /><Kpi label="Margen estimado" value={money(sm.margin)} /><Kpi label="Margen promedio" value={pct(sm.marginPct)} hint="Sobre productos con costo" /></div>
      <div className="tw"><table>
        <thead><tr><th>Producto</th><th className="n">Unidades</th><th className="n">Ingreso neto</th><th className="n">Costo unitario</th><th className="n">Costo total</th><th className="n">Margen</th><th className="n">%</th></tr></thead>
        <tbody>
          {sorted.map((l) => <tr key={l.id}><td className="k"><Link href={`/inventory?v=products&id=${l.id}`} className="text-ink no-underline hover:text-accent">{l.name}</Link></td><td className="n">{n(l.qty)} {l.unit}</td><td className="n">{money(l.revenue)}</td>
            <td className="n">{l.cost != null && l.qty > 0 ? money(l.cost / l.qty) : <Pill tone="amber">Sin costo</Pill>}</td><td className="n">{l.cost != null ? money(l.cost) : "—"}</td>
            <td className={`n ${l.margin != null && l.margin < 0 ? "out" : ""}`}>{l.margin != null ? money(l.margin) : "—"}</td><td className={`n ${l.marginPct != null && l.marginPct < 0 ? "out" : ""}`}>{pct(l.marginPct)}</td></tr>)}
          {!sorted.length && <Empty cols={7}>No hubo ventas en el período.</Empty>}
        </tbody>
      </table></div>
    </div>
  );
  const aside = (
    <>
      <Card title="Acciones"><div className="grid gap-2"><a href={`/api/reports/export?${q}`} className="btn btn-green no-underline">Descargar CSV</a><Link href="/purchases?v=orders" className="btn btn-gray no-underline">Órdenes de compra</Link><Link href="/purchases?v=prices" className="btn btn-gray no-underline">Comparar precios de compra</Link></div></Card>
      <Card title="Es una estimación"><ul className="grid gap-2 text-sm text-mute"><li>El costo es el <b>promedio ponderado actual</b> de tus compras, no el costo del momento de cada venta.</li><li>Lo enviado a la red se valúa a precio de lista actual.</li><li>No incluye gastos (alquiler, sueldos, flete) ni IVA.</li></ul></Card>
    </>
  );
  return { title: "Margen estimado", intro: "Cuánto ganás por producto: ingreso neto menos costo promedio de compra.", main, aside };
}
