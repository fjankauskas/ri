import Link from "next/link";
import Alert from "@/components/Alert";
import { Card, FilterMenu, Empty } from "@/components/ui";
import { idleLines, idleValue, type IdleRow } from "@/lib/reports";
import { money, n, day } from "@/lib/format";
import { mk } from "@/lib/url";
import { Kpi } from "./shared";
import type { View, ViewCtx } from "@/lib/view";

const DAYS: [string, string][] = [["30", "30 días"], ["60", "60 días"], ["90", "90 días"], ["180", "6 meses"], ["365", "1 año"]];
export default async function IdleReport({ sb, org, P }: ViewCtx): Promise<View> {
  const days = Number(DAYS.find(([k]) => k === P.k)?.[0] ?? 90);
  const { data, error } = await sb.rpc("report_idle", { p_org: org.id, p_days: days });
  const L = idleLines(((data as IdleRow[]) ?? [])), never = L.filter((l) => l.days == null).length, noCost = L.filter((l) => l.value == null).length;
  const main = (
    <div className="grid gap-6">
      {error && <Alert tone="danger" title="No se pudo armar el reporte">{error.message}. ¿Ejecutaste la migración 0009?</Alert>}
      <div className="flex flex-wrap items-center gap-3"><FilterMenu label="Sin salidas hace" value={String(days)} options={DAYS.map(([key, label]) => ({ key, label, href: mk("/reports", { ...P, v: "idle" }, { k: key === "90" ? null : key }) }))} /></div>
      <div className="grid gap-4 sm:grid-cols-3"><Kpi label="Productos sin movimiento" value={L.length} hint={`Con stock y sin ventas ni envíos hace ${days} días o más`} /><Kpi label="Capital inmovilizado" value={money(idleValue(L))} hint={noCost ? `A costo promedio; ${noCost} sin costo no suman` : "A costo promedio"} /><Kpi label="Nunca tuvieron salidas" value={never} /></div>
      <div className="tw"><table>
        <thead><tr><th>Producto</th><th className="n">Stock</th><th>Última salida</th><th className="n">Días</th><th className="n">Valor a costo</th><th></th></tr></thead>
        <tbody>
          {L.map((l) => <tr key={l.id}><td className="k">{l.name}<div className="text-xs font-normal text-mute">{l.sku}</div></td><td className="n">{n(l.stock)} {l.unit}</td><td>{l.lastMove ? day(l.lastMove) : <span className="text-mute">Nunca</span>}</td><td className="n">{l.days ?? "—"}</td><td className="n">{l.value != null ? money(l.value) : <span className="text-mute">sin costo</span>}</td>
            <td className="n"><div className="flex items-center justify-end gap-3"><Link href={`/inventory?v=products&id=${l.id}`} className="text-sm">Ver</Link><Link href={`/network?v=market&pub=${l.id}`} className="text-sm">Ofrecer en la red</Link></div></td></tr>)}
          {!L.length && <Empty cols={6}>No hay productos con stock sin movimiento en ese plazo. ¡Buena rotación!</Empty>}
        </tbody>
      </table></div>
    </div>
  );
  const aside = (
    <>
      <Card title="Acciones"><div className="grid gap-2"><a href={`/api/reports/export?report=idle&k=${days}`} className="btn btn-green no-underline">Descargar CSV</a><Link href="/network?v=market" className="btn btn-teal no-underline">Publicar stock en la red</Link></div></Card>
      <Card title="Qué se considera movimiento"><p className="text-sm text-mute">Una salida: venta, envío a otra empresa o consumo en producción. Las entradas (compras, producción) y las transferencias entre depósitos no cuentan.</p></Card>
    </>
  );
  return { title: "Sin movimiento", intro: "Productos con stock que no se vendieron, enviaron ni consumieron en el plazo elegido.", main, aside };
}
