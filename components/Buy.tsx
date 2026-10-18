"use client";
import { useState } from "react";
import { requestPurchase } from "@/app/actions";
import { n, money, priceLabel, total } from "@/lib/format";
export type Offer = { partner_id: string; partner: string; product_id: string; product: string; unit: string; qty: number; price: number | null; price_per: number | null };
const key = (o: Offer) => `${o.partner_id}|${o.product_id}`;
const num = (x: string) => Number(x.replace(",", "."));
const Total = ({ o, qty }: { o: Offer; qty: string }) => {
  const t = total(num(qty), o.price, o.price_per);
  return <p className="tot mu">Precio: {priceLabel(o.price, o.price_per, o.unit)}{t != null && <> · <b>Total: {money(t)}</b></>}</p>;
};
// Formulario completo (pantalla Pedidos): elige proveedor/producto y ve el total antes de enviar.
export function PurchaseForm({ offers, back }: { offers: Offer[]; back: string }) {
  const [sel, setSel] = useState(offers[0] ? key(offers[0]) : "");
  const [qty, setQty] = useState("");
  const o = offers.find((x) => key(x) === sel) ?? offers[0];
  return (
    <form className="f" action={requestPurchase}>
      <input type="hidden" name="back" value={back} />
      <label>Producto de un proveedor
        <select name="offer" required value={o ? key(o) : ""} onChange={(e) => setSel(e.target.value)}>
          {offers.map((x) => <option key={key(x)} value={key(x)}>{x.partner} · {x.product} (hasta {n(x.qty)} {x.unit})</option>)}
        </select>
      </label>
      <label>Cantidad{o ? ` (${o.unit})` : ""}<input name="qty" type="number" step="any" min="0" max={o?.qty} required value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      {o && <Total o={o} qty={qty} />}
      <label>Nota (opcional)<input name="note" /></label>
      <button className="p" disabled={!offers.length}>Enviar pedido de compra</button>
    </form>
  );
}
// Versión compacta (pantalla Red): una fila por producto publicado.
export function BuyInline({ o, back }: { o: Offer; back: string }) {
  const [qty, setQty] = useState("");
  return (
    <form action={requestPurchase} style={{ display: "grid", gap: 4 }}>
      <input type="hidden" name="back" value={back} /><input type="hidden" name="offer" value={key(o)} />
      <div style={{ display: "flex", gap: 6 }}>
        <input name="qty" type="number" step="any" min="0" max={o.qty} placeholder={`Cant. (${o.unit})`} required style={{ width: 110 }} value={qty} onChange={(e) => setQty(e.target.value)} aria-label={`Cantidad de ${o.product} a pedir`} />
        <button className="p">Pedir</button>
      </div>
      {total(num(qty), o.price, o.price_per) != null && <span className="tot">Total: <b>{money(total(num(qty), o.price, o.price_per))}</b></span>}
    </form>
  );
}
