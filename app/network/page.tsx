import { ctx } from "@/lib/ctx";
import Shell, { type SP } from "@/components/Shell";
import Can from "@/components/Can";
import { connect, accept, ship, receive, setOffer, createInvite } from "../actions";
import { BuyInline } from "@/components/Buy";
import { n, posValue, posLabel, POS_P, priceLabel } from "@/lib/format";
export default async function Network({ searchParams }: { searchParams: SP }) {
  const { sb, org, role } = await ctx();
  const [conns, ships, pos, whs, card, offers, mine, prods] = await Promise.all([
    sb.rpc("my_connections"), sb.rpc("my_shipments"),
    sb.from("inventory_positions").select(POS_P).gt("quantity", 0),
    sb.from("warehouses").select("id, name").eq("is_active", true),
    sb.rpc("supplier_scorecard"), sb.rpc("partner_offers"),
    sb.from("stock_offers").select("qty, product_id, products(name, unit, price, price_per)"),
    sb.from("products").select("id, name, unit").eq("is_active", true).order("name"),
  ]);
  const C = (conns.data as any[]) ?? [], S = (ships.data as any[]) ?? [], X = (pos.data as any[]) ?? [], W = whs.data ?? [];
  const active = C.filter((c) => c.status === "ACTIVE");
  const avail = new Map<string, number>();
  for (const x of X) avail.set(x.product_id, (avail.get(x.product_id) ?? 0) + Number(x.quantity) - Number(x.reserved));
  const M = (mine.data as any[]) ?? [];
  return (
    <Shell org={org.display_name} sp={searchParams}>
      <div className="grid">
        <section><h2>Conectar con una empresa</h2><Can role={role}><form className="f" action={connect}>
          <label>CUIT de la empresa<input name="tax_id" required inputMode="numeric" /></label><button className="p">Enviar solicitud</button></form>
          <form className="f" action={createInvite} style={{ marginTop: 12 }}><label>¿No usa la plataforma? Invitala por email<input name="email" type="email" required /></label><button>Invitar</button></form></Can>
          <table><tbody>{C.map((c) => <tr key={c.id}><td>{c.partner}</td><td>{c.status === "ACTIVE" ? "activa" : c.incoming ? "te invitó" : "pendiente"}</td>
            <td>{c.status === "PENDING" && c.incoming && <form action={accept}><input type="hidden" name="id" value={c.id} /><button className="p">Aceptar</button></form>}</td></tr>)}
            {!C.length && <tr><td className="mu">Sin conexiones todavía.</td></tr>}</tbody></table></section>
        <Can role={role}><section><h2>Despachar a una empresa conectada</h2><form className="f" action={ship}>
          <label>Existencia<select name="position" required>{X.map((p) => <option key={posValue(p)} value={posValue(p)}>{posLabel(p)}</option>)}</select></label>
          <label>Destino<select name="to_org" required>{active.map((c) => <option key={c.partner_id} value={c.partner_id}>{c.partner}</option>)}</select></label>
          <label>Cantidad<input name="qty" type="number" step="any" min="0" required /></label><button className="p">Despachar</button></form></section></Can>
        <Can role={role}><section><h2>Stock publicado para tus socios</h2><form className="f" action={setOffer}>
          <label>Producto<select name="product">{(prods.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} — disponible {n(avail.get(p.id) ?? 0)} {p.unit}</option>)}</select></label>
          <label>Cantidad a publicar (hasta tu stock disponible; 0 para retirar)<input name="qty" type="number" step="any" min="0" required /></label><button className="p">Publicar</button></form>
          <p className="mu">Tus socios ven solo la cantidad publicada, nunca tu stock real, y el precio de lista del producto.</p>
          <table><thead><tr><th>Producto</th><th className="n">Publicado</th><th className="n">Disponible</th><th>Precio</th></tr></thead><tbody>
            {M.map((o) => <tr key={o.product_id}><td>{o.products.name}</td><td className="n">{n(o.qty)} {o.products.unit}</td><td className="n">{n(avail.get(o.product_id) ?? 0)}</td><td>{o.products.price == null ? <span className="mu">sin precio</span> : priceLabel(o.products.price, o.products.price_per, o.products.unit)}</td></tr>)}
            {!M.length && <tr><td colSpan={4} className="mu">Todavía no publicaste nada.</td></tr>}</tbody></table></section></Can>
        <section><h2>Stock disponible en tu red</h2>
          {offers.error && <p className="msg bad">Ejecutá las migraciones 0004 y 0005 en Supabase para ver y pedir stock de tus socios.</p>}
          <table><thead><tr><th>Empresa</th><th>Producto</th><th className="n">Disponible</th><th>Precio</th><th>Pedir</th></tr></thead><tbody>
            {((offers.data as any[]) ?? []).map((o) => <tr key={o.partner_id + o.product_id}><td>{o.partner}</td><td>{o.product}</td><td className="n">{n(o.qty)} {o.unit}</td>
              <td>{o.price == null ? <span className="mu">sin precio</span> : priceLabel(o.price, o.price_per, o.unit)}</td>
              <td><Can role={role}><BuyInline o={o} back="/network" /></Can></td></tr>)}
            {!offers.data?.length && <tr><td colSpan={5} className="mu">Tus socios todavía no publicaron stock.</td></tr>}</tbody></table>
          <p className="mu">El proveedor recibe tu pedido, lo acepta o lo rechaza. Seguilo en <a href="/orders">Pedidos</a>.</p></section>
      </div>
      <section><h2>Cumplimiento de proveedores</h2><table><thead><tr><th>Proveedor</th><th className="n">Envíos</th><th className="n">Enviado</th><th className="n">Recibido</th><th className="n">Faltante</th><th className="n">Pendientes</th></tr></thead><tbody>
        {((card.data as any[]) ?? []).map((c) => <tr key={c.partner}><td>{c.partner}</td><td className="n">{c.shipments}</td><td className="n">{n(c.qty_shipped)}</td><td className="n">{n(c.qty_received)}</td>
          <td className={`n ${Number(c.diff_pct) > 0 ? "out" : ""}`}>{c.diff_pct == null ? "—" : `${n(c.diff_pct)}%`}</td><td className="n">{c.pending}</td></tr>)}
        {!card.data?.length && <tr><td colSpan={6} className="mu">Todavía no recibiste envíos.</td></tr>}</tbody></table></section>
      <section><h2>Envíos</h2><table><thead><tr><th>Sentido</th><th>Empresa</th><th>Producto</th><th className="n">Enviado</th><th className="n">Recibido</th><th>Estado</th></tr></thead><tbody>
        {S.map((s) => <tr key={s.id}><td>{s.direction === "OUT" ? "Salida" : "Entrada"}</td><td>{s.partner}</td><td>{s.product} · {s.lot}</td><td className="n">{n(s.qty_shipped)} {s.unit}</td>
          <td className="n">{s.qty_received == null ? "—" : n(s.qty_received)}{s.qty_received != null && s.qty_received < s.qty_shipped && <span className="out"> (−{n(s.qty_shipped - s.qty_received)})</span>}</td>
          <td>{s.status === "RECEIVED" ? "recibido" : s.direction === "IN" && role !== "VIEWER" ?
            <form action={receive} className="f"><input type="hidden" name="ship" value={s.id} />
              <select name="warehouse" aria-label="Depósito">{W.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              <input name="qty" type="number" step="any" defaultValue={s.qty_shipped} aria-label="Cantidad recibida" /><button className="p">Confirmar recepción</button></form> : "en tránsito"}</td></tr>)}
        {!S.length && <tr><td colSpan={6} className="mu">Todavía no hay envíos.</td></tr>}</tbody></table></section>
    </Shell>
  );
}
