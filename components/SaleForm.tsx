"use client";
import { useState } from "react";
import Link from "next/link";
import { createSale } from "@/app/sales-actions";
import { IVA_OPTIONS, computeTotals, type Emisor } from "@/lib/billing";
import { money } from "@/lib/format";
import ScanButton from "./ScanButton";
type Prod = { id: string; sku: string; name: string; unit: string; price: number | null; price_per: number | null; iva: string };
type Row = { product: string; qty: string; price: string; iva: string };
const num = (x: string) => Number(x.replace(",", ".")) || 0;
// Alta de venta: productos con precio e IVA, totales en vivo, descuento de stock del depósito y, si querés, factura en el momento.
export default function SaleForm({ products, customers, warehouses, emisor, canInvoice, back, closeHref, defaultCustomer }: {
  products: Prod[]; customers: { id: string; name: string }[]; warehouses: { id: string; name: string }[]; emisor: Emisor | null; canInvoice: boolean; back: string; closeHref: string; defaultCustomer?: string;
}) {
  const [rows, setRows] = useState<Row[]>([{ product: "", qty: "1", price: "", iva: "21" }]);
  const ri = (emisor ?? "RI") === "RI";
  const pick = (i: number, id: string) => {
    const p = products.find((x) => x.id === id);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, product: id, price: p?.price != null ? String(Math.round((p.price / (p.price_per || 1)) * 10000) / 10000) : "", iva: p?.iva ?? "21" } : r)));
  };
  const [scanMsg, setScanMsg] = useState("");
  const addByCode = async (code: string) => {
    setScanMsg("");
    try {
      const r = await (await fetch(`/api/gs1/lookup?code=${encodeURIComponent(code)}`)).json();
      const p = products.find((x) => x.id === r.product?.id);
      if (!p) return setScanMsg(r.errors?.[0] ?? "Ese código no corresponde a ningún producto cargado.");
      const row: Row = { product: p.id, qty: String(r.unitsPerPack && r.level !== "UNIT" ? r.unitsPerPack : 1), price: p.price != null ? String(Math.round((p.price / (p.price_per || 1)) * 10000) / 10000) : "", iva: p.iva ?? "21" };
      setRows((rs) => (rs.length === 1 && !rs[0].product ? [row] : [...rs, row])); setScanMsg(`Agregado: ${p.name}`);
    } catch { setScanMsg("No se pudo consultar el código."); }
  };
  const upd = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const t = computeTotals(rows.filter((r) => r.product).map((r) => ({ qty: num(r.qty), unit_price: num(r.price), iva: r.iva || "21" })), emisor ?? "RI");
  return (
    <form className="f" action={createSale}>
      <input type="hidden" name="back" value={back} />
      <div className="fgrid">
        <label>Cliente<select name="customer" defaultValue={defaultCustomer ?? ""}><option value="">Consumidor final (sin cliente)</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Depósito de salida<select name="warehouse" required>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Productos <span className="font-normal text-mute">(precios sin IVA{ri ? "" : "; sos monotributista o exento: no se discrimina IVA"})</span></p>
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select name="item_product" value={r.product} onChange={(e) => pick(i, e.target.value)} aria-label={`Producto ${i + 1}`} className="min-w-[12rem] flex-1">
              <option value="">— producto —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select>
            <input name="item_qty" type="number" step="any" min="0" value={r.qty} onChange={(e) => upd(i, "qty", e.target.value)} aria-label="Cantidad" placeholder="Cant." className="w-20!" />
            <input name="item_price" type="number" step="any" min="0" value={r.price} onChange={(e) => upd(i, "price", e.target.value)} aria-label="Precio unitario sin IVA" placeholder="Precio" className="w-28!" />
            <select name="item_iva" value={r.iva} onChange={(e) => upd(i, "iva", e.target.value)} aria-label="IVA" className={`w-36! ${ri ? "" : "hidden"}`}>{IVA_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
            <button type="button" aria-label={`Quitar producto ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="px-3!">✕</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setRows((rs) => [...rs, { product: "", qty: "1", price: "", iva: "21" }])}>＋ Agregar producto</button>
          <ScanButton onCode={addByCode} label="📷 Escanear código de barras" />
          {scanMsg && <span className="text-sm text-mute" role="status">{scanMsg}</span>}
        </div>
      </div>
      <div className="rounded-lg border border-line bg-surface p-4 text-sm">
        <div className="flex justify-between"><span className="text-mute">{ri ? "Subtotal neto" : "Subtotal"}</span><span>{money(t.neto + t.totConc + t.opEx)}</span></div>
        {t.alic.filter((a) => a.rate > 0 || a.importe > 0).map((a) => <div key={a.id} className="flex justify-between"><span className="text-mute">IVA {String(a.rate).replace(".", ",")} %</span><span>{money(a.importe)}</span></div>)}
        <div className="mt-2 flex justify-between border-t border-line pt-2 text-base font-medium"><span>Total</span><span className="text-accent">{money(t.total)}</span></div>
      </div>
      <div className="fgrid">
        <label>Forma de pago<select name="payment"><option value="">—</option><option>Efectivo</option><option>Transferencia</option><option>Tarjeta de débito</option><option>Tarjeta de crédito</option><option>Cuenta corriente</option></select></label>
        <label>Nota (opcional)<input name="notes" /></label>
      </div>
      {canInvoice
        ? <label className="flex items-center gap-2 font-normal"><input type="checkbox" name="invoice_now" defaultChecked /> Emitir la factura electrónica ahora</label>
        : <p className="text-sm text-mute">La facturación electrónica no está lista: podés registrar la venta y facturarla después desde «Ventas».</p>}
      <div className="mt-2 flex gap-3 border-t border-line pt-5">
        <button className="btn btn-green">Registrar venta</button>
        <Link href={closeHref} className="btn btn-gray no-underline">Cancelar</Link>
      </div>
    </form>
  );
}
