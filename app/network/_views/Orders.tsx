import Link from "next/link";
import Modal from "@/components/Modal";
import { PurchaseForm } from "@/components/Buy";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, FormFooter, Stepper, Empty, type PillTone, type Step } from "@/components/ui";
import { createOrder, shipOrder, cancelOrder, acceptPurchase, rejectPurchase, cancelPurchase } from "@/app/actions";
import { n, money, when, posValue, posLabel, POS_P, priceLabel } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

type Row = { key: string; src: "req" | "ord"; id: string; dir: string; group: "buy" | "sell"; kind: string; partner: string; product: string; qty: number; unit: string; total: number | null; price: string | null; date: string; st: string; label: string; tone: PillTone; note?: string };
const REQ: Record<string, [string, PillTone]> = { REQUESTED: ["Pendiente", "amber"], REJECTED: ["Rechazada", "red"], CANCELLED: ["Cancelada", "gray"] };
const ORD: Record<string, [string, PillTone]> = { CONFIRMED: ["Confirmado", "blue"], SHIPPED: ["Despachado", "blue"], RECEIVED: ["Recibido", "green"], CANCELLED: ["Cancelado", "gray"] };
const FILTERS: [string, string][] = [["all", "Todos"], ["buy", "Compras"], ["sell", "Ventas"], ["todo", "Por responder o despachar"]];

function steps(r: Row): Step[] {
  if (r.src === "req") {
    const last: Step = r.st === "REQUESTED" ? { title: "Respuesta del proveedor", detail: "Esperando que acepte o rechace", state: "current" } : r.st === "REJECTED" ? { title: "Rechazado por el proveedor", state: "fail" } : { title: "Cancelado por el comprador", state: "fail" };
    return [{ title: "Solicitud de compra enviada", detail: when(r.date), state: "done" }, last];
  }
  if (r.st === "CANCELLED") return [{ title: "Pedido confirmado", detail: when(r.date), state: "done" }, { title: "Pedido cancelado", detail: "La reserva de stock se liberó", state: "fail" }];
  const shipped = r.st === "SHIPPED" || r.st === "RECEIVED", received = r.st === "RECEIVED";
  return [
    { title: "Pedido confirmado", detail: `${when(r.date)} · stock reservado`, state: "done" },
    { title: "Despachado", detail: shipped ? "En camino al comprador" : "Pendiente de despacho", state: shipped ? "done" : "current" },
    { title: "Recibido", detail: received ? "El comprador confirmó la recepción" : "Pendiente de recepción", state: received ? "done" : shipped ? "current" : "todo" },
  ];
}

export default async function OrdersView({ sb, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/network", { ...P, v: "orders" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), t = P.t ?? "all", sel = P.o ?? "", modal = P.modal ?? "";
  const canWrite = role !== "VIEWER";
  const [pos, conns, ords, offers, reqs] = await Promise.all([
    sb.from("inventory_positions").select(POS_P).gt("quantity", 0), sb.rpc("my_connections"), sb.rpc("my_orders"), sb.rpc("partner_offers"), sb.rpc("my_purchase_requests"),
  ]);
  const X = (pos.data as any[]) ?? [], A = ((conns.data as any[]) ?? []).filter((c) => c.status === "ACTIVE");
  const O = (ords.data as any[]) ?? [], R = (reqs.data as any[]) ?? [], OFF = (offers.data as any[]) ?? [];
  const all: Row[] = [
    ...R.filter((r) => r.status !== "ACCEPTED").map((r): Row => ({ key: "r" + r.id, src: "req", id: r.id, dir: r.direction, group: r.direction === "RECEIVED" ? "sell" : "buy", kind: r.direction === "RECEIVED" ? "Solicitud recibida" : "Solicitud enviada", partner: r.partner, product: r.product, qty: Number(r.qty), unit: r.unit, total: r.total, price: r.unit_price != null ? priceLabel(r.unit_price, r.price_per, r.unit) : null, date: r.created_at, st: r.status, label: REQ[r.status]?.[0] ?? r.status, tone: REQ[r.status]?.[1] ?? "gray", note: r.note })),
    ...O.map((o): Row => ({ key: "o" + o.id, src: "ord", id: o.id, dir: o.direction, group: o.direction === "OUT" ? "sell" : "buy", kind: o.direction === "OUT" ? "Venta" : "Compra", partner: o.partner, product: `${o.product} · ${o.lot}`, qty: Number(o.qty), unit: o.unit, total: o.total, price: o.price != null ? priceLabel(o.price, o.price_per, o.unit) : null, date: o.created_at, st: o.status, label: ORD[o.status]?.[0] ?? o.status, tone: ORD[o.status]?.[1] ?? "gray" })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  const todo = (r: Row) => (r.src === "req" && r.dir === "RECEIVED" && r.st === "REQUESTED") || (r.src === "ord" && r.dir === "OUT" && r.st === "CONFIRMED");
  const rows = all.filter((r) => (!q || r.partner.toLowerCase().includes(q) || r.product.toLowerCase().includes(q)) && (t === "all" || (t === "todo" ? todo(r) : r.group === t)));
  const cur = all.find((r) => r.key === sel);
  const back = L({ modal: null });
  const hidden = <input type="hidden" name="back" value={back} />;
  const idf = (r: Row) => <><input type="hidden" name="id" value={r.id} />{hidden}</>;

  const main = (
    <div>
      {(offers.error || reqs.error) && <p role="alert" className="mb-4 text-bad">Los pedidos de compra no están disponibles: ejecutá las migraciones 0004 a 0006 en Supabase.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/network" keep={{ v: "orders", t: t === "all" ? undefined : t }} q={P.q} placeholder="Buscar por empresa o producto…" />
        <FilterMenu label="Mostrar" value={t} options={FILTERS.map(([key, label]) => ({ key, label, href: L({ t: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Tipo</th><th>Empresa</th><th>Producto</th><th className="n">Cantidad</th><th className="n">Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} aria-selected={sel === r.key}>
              <td>{r.kind}</td><td className="k">{r.partner}</td><td>{r.product}</td>
              <td className="n">{n(r.qty)} {r.unit}</td>
              <td className="n">{r.total == null ? "—" : money(r.total)}{r.price && <div className="text-xs text-mute">{r.price}</div>}</td>
              <td><Pill tone={r.tone}>{r.label}</Pill></td>
              <td>
                <div className="flex items-center justify-end gap-2">
                  {canWrite && r.src === "req" && r.st === "REQUESTED" && r.dir === "RECEIVED" && (<>
                    <form action={acceptPurchase}>{idf(r)}<button className="btn btn-green btn-sm">Aceptar</button></form>
                    <form action={rejectPurchase}>{idf(r)}<button className="btn btn-gray btn-sm">Rechazar</button></form></>)}
                  {canWrite && r.src === "req" && r.st === "REQUESTED" && r.dir === "SENT" && <form action={cancelPurchase}>{idf(r)}<button className="btn btn-gray btn-sm">Cancelar</button></form>}
                  {canWrite && r.src === "ord" && r.dir === "OUT" && r.st === "CONFIRMED" && (<>
                    <form action={shipOrder}>{idf(r)}<button className="btn btn-green btn-sm">Despachar</button></form>
                    <form action={cancelOrder}>{idf(r)}<button className="btn btn-gray btn-sm">Cancelar</button></form></>)}
                  {r.src === "ord" && r.dir === "IN" && r.st === "SHIPPED" && <Link href="/network?v=shipments&d=transit" className="btn btn-teal btn-sm no-underline">Recibir</Link>}
                  <Link href={L({ o: r.key, modal: null })} className="text-sm">Detalle</Link>
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && <Empty cols={7}>{all.length ? "Ningún pedido coincide con la búsqueda o el filtro." : "Todavía no hay pedidos. Creá uno con las acciones de la derecha."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">{rows.length} de {all.length} pedidos. Al aceptar una solicitud de compra, el stock se reserva y el pedido pasa a «Confirmado» para despacharlo.</p>

      {canWrite && modal === "purchase" && (
        <Modal title="Nuevo pedido de compra" closeHref={back}>
          <p className="mb-4 text-sm text-mute">Pedí stock que publicaron tus proveedores conectados. Ellos lo aceptan o lo rechazan.</p>
          {OFF.length ? <PurchaseForm offers={OFF} back={back} initial={P.offer} closeHref={back} /> : <p className="text-mute">Ninguna empresa conectada publicó stock todavía. Conectate desde <Link href="/network?v=partners">Empresas</Link>.</p>}
        </Modal>
      )}
      {canWrite && modal === "sale" && (
        <Modal title="Nuevo pedido de venta" closeHref={back}>
          <form className="f" action={createOrder}>
            {hidden}
            <p className="text-sm text-mute">Reserva stock para un cliente conectado: no podrá usarse en otra operación hasta despacharlo o cancelarlo.</p>
            <label>Existencia<select name="position" required>{X.map((p) => <option key={posValue(p)} value={posValue(p)}>{posLabel(p)}</option>)}</select></label>
            <label>Cliente conectado<select name="buyer" required>{A.map((c) => <option key={c.partner_id} value={c.partner_id}>{c.partner}</option>)}</select></label>
            <label>Cantidad<input name="qty" type="number" step="any" min="0" required /></label>
            <FormFooter submit="Confirmar y reservar" closeHref={back} />
          </form>
        </Modal>
      )}
    </div>
  );

  const aside = (
    <>
      {canWrite && (
        <Card title="Acciones" sub="Qué podés hacer con tus pedidos.">
          <div className="grid gap-2">
            <ActionLink href={L({ modal: "purchase" })} icon="orders">Nuevo pedido de compra</ActionLink>
            <ActionLink href={L({ modal: "sale" })} icon="plus" tone="teal">Nuevo pedido de venta</ActionLink>
            <ActionLink href="/network?v=market" icon="market" tone="gray">Ver stock de la red</ActionLink>
          </div>
        </Card>
      )}
      {cur && (
        <Card title="Detalle del pedido">
          <dl className="grid gap-2 text-sm">
            {([["Tipo", cur.kind], ["Empresa", cur.partner], ["Producto", cur.product], ["Cantidad", `${n(cur.qty)} ${cur.unit}`], ["Total", cur.total == null ? "—" : money(cur.total)]] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-mute">{k}</dt><dd className="text-right">{v}</dd></div>
            ))}
            {cur.note && <div className="flex justify-between gap-3"><dt className="text-mute">Nota</dt><dd className="text-right">{cur.note}</dd></div>}
          </dl>
          <div className="mt-5 border-t border-line pt-5"><Stepper steps={steps(cur)} /></div>
          <Link href={L({ o: null })} className="mt-4 inline-block text-sm">Cerrar detalle</Link>
        </Card>
      )}
    </>
  );
  return { title: "Pedidos", intro: "Compras y ventas con tus empresas conectadas, de la solicitud a la recepción.", main, aside };
}
