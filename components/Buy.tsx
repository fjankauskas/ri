"use client";
import { useState } from "react";
import Link from "next/link";
import { requestPurchase } from "@/app/actions";
import { n, money, priceLabel, total } from "@/lib/format";
export type Offer = { partner_id: string; partner: string; product_id: string; product: string; unit: string; qty: number; price: number | null; price_per: number | null };
const key = (o: Offer) => `${o.partner_id}|${o.product_id}`;
const num = (x: string) => Number(x.replace(",", "."));
// Pedido de compra: elegís proveedor/producto y ves el total antes de enviar.
export function PurchaseForm({ offers, back, initial, closeHref }: { offers: Offer[]; back: string; initial?: string; closeHref?: string }) {
  const first = offers.find((x) => key(x) === initial) ?? offers[0];
  const [sel, setSel] = useState(first ? key(first) : "");
  const [qty, setQty] = useState("");
  const o = offers.find((x) => key(x) === sel) ?? first;
  const t = o ? total(num(qty), o.price, o.price_per) : null;
  return (
    <form className="f" action={requestPurchase}>
      <input type="hidden" name="back" value={back} />
      <label>Producto de un proveedor
        <select name="offer" required value={o ? key(o) : ""} onChange={(e) => setSel(e.target.value)}>
          {offers.map((x) => <option key={key(x)} value={key(x)}>{x.partner} · {x.product} (hasta {n(x.qty)} {x.unit})</option>)}
        </select>
      </label>
      <label>Cantidad{o ? ` (${o.unit})` : ""}<input name="qty" type="number" step="any" min="0" max={o?.qty} required value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      {o && <p className="tot text-mute">Precio: {priceLabel(o.price, o.price_per, o.unit)}{t != null && <> · <b>Total: {money(t)}</b></>}</p>}
      <label>Nota (opcional)<input name="note" /></label>
      <div className="mt-2 flex gap-3 border-t border-line pt-5">
        <button className="btn btn-green" disabled={!offers.length}>Enviar pedido de compra</button>
        {closeHref && <Link href={closeHref} className="btn btn-gray no-underline">Cancelar</Link>}
      </div>
    </form>
  );
}
