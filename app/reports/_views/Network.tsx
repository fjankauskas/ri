import Link from "next/link";
import Alert from "@/components/Alert";
import { Card, Empty } from "@/components/ui";
import { rank } from "@/lib/reports";
import { money, n } from "@/lib/format";
import { Filters, Kpi, loadSales } from "./shared";
import type { View, ViewCtx } from "@/lib/view";

export default async function NetworkReport({ sb, org, P }: ViewCtx): Promise<View> {
  const d = await loadSales(sb, org.id, { ...P, c: "network" });
  const { data, error } = await sb.rpc("report_network", { p_org: org.id, p_from: d.from, p_to: d.to });
  const R = ((data as any[]) ?? []), sent = R.reduce((a, r) => a + Number(r.sent_value), 0), recv = R.reduce((a, r) => a + Number(r.received_value), 0), top = rank(d.lines, "qty", "desc", 10);
  const q = new URLSearchParams({ report: "network", d: P.d ?? "30" }).toString();
  const main = (
    <div className="grid gap-6">
      {(error || d.error) && <Alert tone="danger" title="No se pudo armar el reporte">{error?.message ?? d.error}. ¿Ejecutaste la migración 0009?</Alert>}
      <Filters base="/reports" v="network" P={{ ...P, c: undefined }} />
      <div className="grid gap-4 sm:grid-cols-3"><Kpi label="Enviado a la red" value={money(sent)} hint="Valor estimado a precio de lista" /><Kpi label="Recibido de la red" value={money(recv)} hint="Valor estimado a precio de lista del proveedor" /><Kpi label="Saldo" value={money(sent - recv)} hint={sent >= recv ? "Le vendés más de lo que comprás" : "Le comprás más de lo que vendés"} /></div>
      <div><h2 className="mb-3">Por empresa conectada</h2><div className="tw"><table>
        <thead><tr><th>Empresa</th><th className="n">Enviado</th><th className="n">Recibido</th><th className="n">Saldo</th><th className="n">Envíos</th></tr></thead>
        <tbody>{R.map((r) => <tr key={r.partner_id}><td className="k">{r.partner}</td><td className="n">{money(r.sent_value)}</td><td className="n">{money(r.received_value)}</td><td className={`n ${Number(r.sent_value) - Number(r.received_value) < 0 ? "out" : ""}`}>{money(Number(r.sent_value) - Number(r.received_value))}</td><td className="n">{r.shipments}</td></tr>)}{!R.length && <Empty cols={5}>No hubo envíos con la red en el período.</Empty>}</tbody>
      </table></div></div>
      <div><h2 className="mb-3">Productos que más salen hacia la red</h2><div className="tw"><table>
        <thead><tr><th>Producto</th><th className="n">Unidades enviadas</th><th className="n">Valor estimado</th></tr></thead>
        <tbody>{top.map((l) => <tr key={l.id}><td className="k"><Link href={`/inventory?v=products&id=${l.id}`} className="text-ink no-underline hover:text-accent">{l.name}</Link></td><td className="n">{n(l.qty)} {l.unit}</td><td className="n">{money(l.revenue)}</td></tr>)}{!top.length && <Empty cols={3}>Sin envíos de productos en el período.</Empty>}</tbody>
      </table></div></div>
    </div>
  );
  const aside = (
    <>
      <Card title="Acciones"><div className="grid gap-2"><a href={`/api/reports/export?${q}`} className="btn btn-green no-underline">Descargar CSV</a><Link href="/network?v=partners" className="btn btn-gray no-underline">Empresas conectadas</Link><Link href="/network?v=shipments" className="btn btn-gray no-underline">Envíos</Link></div></Card>
      <Card title="Qué ves y qué no"><p className="text-sm text-mute">Solo los movimientos en los que participó tu empresa. Nunca se muestran ventas, stock ni márgenes internos de otras empresas: cada empresa solo ve su propia información.</p></Card>
    </>
  );
  return { title: "Comercio con la red", intro: "Cuánto enviás y recibís de cada empresa conectada, y qué productos mueven más.", main, aside };
}
