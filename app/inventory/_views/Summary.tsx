import Link from "next/link";
import Alert from "@/components/Alert";
import { Card, ActionLink, Empty } from "@/components/ui";
import { n, when, TYPES } from "@/lib/format";
import type { View, ViewCtx } from "@/lib/view";

export default async function SummaryView({ sb, badges }: ViewCtx): Promise<View> {
  const [pos, ev, drift, al] = await Promise.all([
    sb.from("inventory_positions").select("*", { count: "exact", head: true }).gt("quantity", 0),
    sb.from("inventory_events").select("id, event_type, quantity, occurred_at, lot_id, products(name, unit), lots(lot_number), from:warehouses!from_warehouse_id(name), to:warehouses!to_warehouse_id(name)").order("id", { ascending: false }).limit(15),
    sb.from("inventory_drift").select("*", { count: "exact", head: true }),
    sb.rpc("my_alerts"),
  ]);
  const alerts = (al.data as any[]) ?? [], events = (ev.data as any[]) ?? [];
  const kpi: [string, React.ReactNode][] = [
    ["Posiciones con stock", pos.count ?? 0],
    ["Envíos por recibir", badges.incoming],
    ["Stock = suma de eventos", drift.count ? <span className="out">{drift.count} diferencias</span> : <span className="in">Verificado</span>],
  ];
  const main = (
    <div className="grid gap-6">
      {(alerts.length > 0 || badges.requests > 0 || badges.incoming > 0 || badges.dispatch > 0) && (
        <div className="grid gap-3">
          {alerts.map((a, i) => (
            <Alert key={i} tone={a.kind === "LOW_STOCK" ? "warning" : "danger"} title={a.kind === "LOW_STOCK" ? "Stock bajo" : "Por vencer"} href={`/inventory?v=products&q=${encodeURIComponent(String(a.label).split(" · ")[0])}`} action="Ver producto">
              {a.label} — {a.detail}
            </Alert>
          ))}
          {badges.requests > 0 && <Alert tone="info" title={`Tenés ${badges.requests} pedido(s) de compra por responder`} href="/network?v=orders&t=todo" action="Responder" />}
          {badges.dispatch > 0 && <Alert tone="info" title={`Tenés ${badges.dispatch} pedido(s) confirmados para despachar`} href="/network?v=orders&t=todo" action="Despachar" />}
          {badges.incoming > 0 && <Alert tone="info" title={`Tenés ${badges.incoming} envío(s) por recibir`} href="/network?v=shipments&d=transit" action="Recibir" />}
        </div>
      )}
      {!alerts.length && <p className="text-sm text-mute">Sin alertas de stock. Definí un stock mínimo en los productos y cargá vencimientos en los lotes para recibirlas.</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        {kpi.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-card p-5">
            <p className="text-sm text-mute">{label}</p>
            <p className="mt-2 text-3xl font-light">{value}</p>
          </div>
        ))}
      </div>
      <div>
        <h2 className="mb-3">Últimos movimientos</h2>
        <div className="tw"><table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Producto y lote</th><th>Recorrido</th><th className="n">Cantidad</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{when(e.occurred_at)}</td><td>{TYPES[e.event_type]}</td>
                <td className="k">{e.products.name} · <Link href={`/inventory?v=trace&lot=${e.lot_id}`}>{e.lots.lot_number}</Link></td>
                <td>{e.from?.name ?? "Externo"} → {e.to?.name ?? "Externo"}</td>
                <td className="n">{n(e.quantity)} {e.products.unit}</td>
              </tr>
            ))}
            {!events.length && <Empty cols={5}>Todavía no hay movimientos. Creá un producto e ingresá stock en «Productos y stock».</Empty>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
  const aside = (
    <Card title="Acciones rápidas" sub="Atajos a lo que más se hace.">
      <div className="grid gap-2">
        <ActionLink href="/inventory?v=products&modal=product" icon="plus">Nuevo producto</ActionLink>
        <ActionLink href="/inventory?v=products&modal=stock" icon="upload" tone="teal">Ingresar stock</ActionLink>
        <ActionLink href="/inventory?v=production" icon="factory" tone="cyan">Producir</ActionLink>
        <ActionLink href="/network?v=orders&modal=purchase" icon="orders" tone="gray">Nuevo pedido de compra</ActionLink>
        <ActionLink href="/inventory?v=trace&modal=scan" icon="scan" tone="gray">Escanear un lote</ActionLink>
      </div>
    </Card>
  );
  return { title: "Resumen", intro: "Lo que necesita tu atención y lo último que pasó en tu inventario.", main, aside };
}
