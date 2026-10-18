import { ctx } from "@/lib/ctx";
import Shell, { type SP } from "@/components/Shell";
import Can from "@/components/Can";
import { createOrder, shipOrder, cancelOrder, acceptPurchase, rejectPurchase, cancelPurchase } from "../actions";
import { n, money, when, posValue, posLabel, POS_P, priceLabel } from "@/lib/format";
import { PurchaseForm } from "@/components/Buy";
const STATUS: Record<string, string> = { CONFIRMED: "confirmado", SHIPPED: "despachado", RECEIVED: "recibido", CANCELLED: "cancelado" };
const REQ: Record<string, string> = { REQUESTED: "pendiente", ACCEPTED: "aceptado", REJECTED: "rechazado", CANCELLED: "cancelado" };
export default async function Orders({ searchParams }: { searchParams: SP }) {
  const { sb, org, role } = await ctx();
  const [pos, conns, ords, offers, reqs] = await Promise.all([
    sb.from("inventory_positions").select(POS_P).gt("quantity", 0), sb.rpc("my_connections"), sb.rpc("my_orders"),
    sb.rpc("partner_offers"), sb.rpc("my_purchase_requests")]);
  const A = ((conns.data as any[]) ?? []).filter((c) => c.status === "ACTIVE"), O = (ords.data as any[]) ?? [];
  const OFF = (offers.data as any[]) ?? [], R = (reqs.data as any[]) ?? [];
  const pending = R.filter((r) => r.direction === "RECEIVED" && r.status === "REQUESTED").length;
  return (
    <Shell org={org.display_name} sp={searchParams}>
      {(offers.error || reqs.error) && <p role="alert" className="msg bad">Los pedidos de compra no están disponibles: ejecutá las migraciones 0004 y 0005 en Supabase.</p>}
      <Can role={role}><div className="grid">
        <section><h2>Pedido de compra</h2><p className="mu">Pedí stock que publicaron tus proveedores conectados. Ellos lo aceptan o lo rechazan.</p>
          <PurchaseForm offers={OFF} back="/orders" />
          {!OFF.length && <p className="mu">Ninguna empresa conectada publicó stock todavía. Podés conectarte desde «Red».</p>}</section>
        <section><h2>Pedido de venta con reserva</h2><form className="f" action={createOrder}>
          <label>Existencia<select name="position">{((pos.data as any[]) ?? []).map((p) => <option key={posValue(p)} value={posValue(p)}>{posLabel(p)}</option>)}</select></label>
          <label>Cliente conectado<select name="buyer">{A.map((c) => <option key={c.partner_id} value={c.partner_id}>{c.partner}</option>)}</select></label>
          <label>Cantidad<input name="qty" type="number" step="any" min="0" required /></label><button className="p">Confirmar y reservar</button></form></section>
      </div></Can>
      <section><h2>Pedidos de compra {pending > 0 && <span className="tag low">{pending} por responder</span>}</h2><table><thead><tr><th>Tipo</th><th>Empresa</th><th>Producto</th><th className="n">Cantidad</th><th className="n">Total</th><th>Nota</th><th>Fecha</th><th>Estado</th><th></th></tr></thead><tbody>
        {R.map((r) => <tr key={r.id}><td>{r.direction === "RECEIVED" ? "Recibido" : "Enviado"}</td><td>{r.partner}</td><td>{r.product}</td><td className="n">{n(r.qty)} {r.unit}</td><td className="n">{r.total == null ? "—" : money(r.total)}{r.unit_price != null && <div className="mu">{priceLabel(r.unit_price, r.price_per, r.unit)}</div>}</td><td className="mu">{r.note ?? ""}</td><td>{when(r.created_at)}</td><td>{REQ[r.status]}</td>
          <td>{role !== "VIEWER" && r.status === "REQUESTED" && (r.direction === "RECEIVED"
            ? <div style={{ display: "flex", gap: 6 }}><form action={acceptPurchase}><input type="hidden" name="id" value={r.id} /><button className="p">Aceptar y reservar</button></form>
                <form action={rejectPurchase}><input type="hidden" name="id" value={r.id} /><button>Rechazar</button></form></div>
            : <form action={cancelPurchase}><input type="hidden" name="id" value={r.id} /><button>Cancelar</button></form>)}</td></tr>)}
        {!R.length && <tr><td colSpan={9} className="mu">Sin pedidos de compra. Al aceptar uno recibido, el stock se reserva y aparece abajo como pedido de venta para despachar.</td></tr>}</tbody></table></section>
      <section><h2>Pedidos</h2><table><thead><tr><th>Sentido</th><th>Empresa</th><th>Producto</th><th className="n">Cantidad</th><th className="n">Total</th><th>Estado</th><th></th></tr></thead><tbody>
        {O.map((o) => <tr key={o.id}><td>{o.direction === "OUT" ? "Venta" : "Compra"}</td><td>{o.partner}</td><td>{o.product} · {o.lot}</td><td className="n">{n(o.qty)} {o.unit}</td>
          <td className="n">{o.total == null ? "—" : money(o.total)}{o.price != null && <div className="mu">{priceLabel(o.price, o.price_per, o.unit)}</div>}</td><td>{STATUS[o.status]}</td>
          <td>{o.direction === "OUT" && o.status === "CONFIRMED" && role !== "VIEWER" && <div style={{ display: "flex", gap: 6 }}>
            <form action={shipOrder}><input type="hidden" name="id" value={o.id} /><button className="p">Despachar</button></form>
            <form action={cancelOrder}><input type="hidden" name="id" value={o.id} /><button>Cancelar</button></form></div>}
            {o.direction === "IN" && o.status === "SHIPPED" && <a href="/network">Confirmar recepción en Red</a>}</td></tr>)}
        {!O.length && <tr><td colSpan={7} className="mu">Sin pedidos. Al confirmar uno, el stock se reserva y no se puede usar en otra operación.</td></tr>}</tbody></table></section>
    </Shell>
  );
}
