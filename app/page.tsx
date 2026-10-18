import { ctx } from "@/lib/ctx";
import Shell, { type SP } from "@/components/Shell";
import { n, TYPES, POS_SELECT } from "@/lib/format";
export default async function Home({ searchParams }: { searchParams: SP }) {
  const { sb, org } = await ctx();
  const [pos, ev, drift, sh, al] = await Promise.all([
    sb.from("inventory_positions").select(POS_SELECT).gt("quantity", 0).order("product_id"),
    sb.from("inventory_events").select("id, event_type, quantity, occurred_at, products(name, unit), lots(lot_number), from:warehouses!from_warehouse_id(name), to:warehouses!to_warehouse_id(name)").order("id", { ascending: false }).limit(15),
    sb.from("inventory_drift").select("*", { count: "exact", head: true }),
    sb.rpc("my_shipments"),
    sb.rpc("my_alerts"),
  ]);
  const incoming = ((sh.data as any[]) ?? []).filter((s) => s.direction === "IN" && s.status === "IN_TRANSIT").length;
  const alerts = (al.data as any[]) ?? [];
  return (
    <Shell org={org.display_name} sp={searchParams}>
      <div className="grid">
        <section><h2>Estado</h2><table><tbody>
          <tr><td>Posiciones con stock</td><td className="n">{pos.data?.length ?? 0}</td></tr>
          <tr><td>Envíos por recibir</td><td className="n">{incoming}</td></tr>
          <tr><td>Stock = suma de eventos</td><td className="n"><b className={drift.count ? "out" : "in"}>{drift.count ? `${drift.count} diferencias` : "verificado"}</b></td></tr>
        </tbody></table></section>
        <section><h2>Alertas</h2>{alerts.length ? <table><tbody>{alerts.map((a, i) => <tr key={i}><td className="out">{a.kind === "LOW_STOCK" ? "Stock bajo" : "Por vencer"}</td><td>{a.label}<div className="mu">{a.detail}</div></td></tr>)}</tbody></table>
          : <p className="mu">Sin alertas. Definí un stock mínimo en los productos y cargá vencimientos en los lotes.</p>}</section>
      </div>
      <section><h2>Inventario</h2><table><thead><tr><th>Producto</th><th>Lote</th><th>Depósito</th><th className="n">Stock</th><th className="n">Reservado</th></tr></thead><tbody>
        {(pos.data as any[] ?? []).map((p) => <tr key={p.warehouse_id + p.product_id + p.lot_id}><td>{p.products.name}</td><td><a href={`/trace?lot=${p.lot_id}`}>{p.lots.lot_number}</a></td><td>{p.warehouses.name}</td><td className="n">{n(p.quantity)} {p.products.unit}</td><td className="n">{n(p.reserved)}</td></tr>)}
        {!pos.data?.length && <tr><td colSpan={5} className="mu">Todavía no hay stock. Creá un producto e ingresá stock en «Productos y stock».</td></tr>}
      </tbody></table></section>
      <section><h2>Últimos movimientos</h2><table><thead><tr><th>Tipo</th><th>Producto</th><th>Recorrido</th><th className="n">Cantidad</th></tr></thead><tbody>
        {(ev.data as any[] ?? []).map((e) => <tr key={e.id}><td>{TYPES[e.event_type]}</td><td>{e.products.name} · {e.lots.lot_number}</td><td>{e.from?.name ?? "Externo"} → {e.to?.name ?? "Externo"}</td><td className="n">{n(e.quantity)} {e.products.unit}</td></tr>)}
      </tbody></table></section>
    </Shell>
  );
}
