"use client";
import { useState } from "react";
import Link from "next/link";
import { createPo } from "@/app/purchases-actions";
import { IVA_OPTIONS, computeTotals } from "@/lib/billing";
import { money } from "@/lib/format";
type Prod = { id: string; name: string; sku: string; unit: string; iva: string };
type Row = { product: string; qty: string; price: string; iva: string };
const num = (x: string) => Number(x.replace(",", ".")) || 0;
/** Orden de compra: el precio se completa con el último que pagaste a ese proveedor (se puede cambiar). */
export default function PoForm({ suppliers, products, last, back, closeHref, initialSupplier }: { suppliers: { id: string; name: string; payment_days: number }[]; products: Prod[]; last: Record<string, Record<string, number>>; back: string; closeHref: string; initialSupplier?: string }) {
  const [supplier, setSupplier] = useState(suppliers.find((s) => s.id === initialSupplier)?.id ?? suppliers[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([{ product: "", qty: "1", price: "", iva: "21" }]);
  const pick = (i: number, id: string) => { const p = products.find((x) => x.id === id), lp = last[supplier]?.[id]; setRows((rs) => rs.map((r, j) => (j === i ? { ...r, product: id, price: lp != null ? String(lp) : r.price, iva: p?.iva ?? "21" } : r))); };
  const upd = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const t = computeTotals(rows.filter((r) => r.product).map((r) => ({ qty: num(r.qty), unit_price: num(r.price), iva: r.iva || "21" })), "RI");
  const sup = suppliers.find((s) => s.id === supplier);
  return (
    <form className="f" action={createPo}>
      <input type="hidden" name="back" value={back} />
      <div className="fgrid">
        <label>Proveedor<select name="supplier" required value={supplier} onChange={(e) => setSupplier(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Entrega esperada<input name="expected" type="date" /></label>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Productos <span className="font-normal text-mute">(precio neto por unidad de medida, sin IVA)</span></p>
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select name="item_product" value={r.product} onChange={(e) => pick(i, e.target.value)} aria-label={`Producto ${i + 1}`} className="min-w-[12rem] flex-1"><option value="">— producto —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku}) · {p.unit}</option>)}</select>
            <input name="item_qty" type="number" step="any" min="0" value={r.qty} onChange={(e) => upd(i, "qty", e.target.value)} aria-label="Cantidad" placeholder="Cant." className="w-20!" />
            <input name="item_price" type="number" step="any" min="0" value={r.price} onChange={(e) => upd(i, "price", e.target.value)} aria-label="Precio unitario sin IVA" placeholder="Precio" className="w-28!" />
            <select name="item_iva" value={r.iva} onChange={(e) => upd(i, "iva", e.target.value)} aria-label="IVA" className="w-36!">{IVA_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
            <button type="button" aria-label={`Quitar producto ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="px-3!">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, { product: "", qty: "1", price: "", iva: "21" }])} className="justify-self-start">＋ Agregar producto</button>
      </div>
      <div className="rounded-lg border border-line bg-surface p-4 text-sm">
        <div className="flex justify-between"><span className="text-mute">Subtotal neto</span><span>{money(t.neto + t.totConc + t.opEx)}</span></div>
        <div className="flex justify-between"><span className="text-mute">IVA</span><span>{money(t.iva)}</span></div>
        <div className="mt-2 flex justify-between border-t border-line pt-2 text-base font-medium"><span>Total estimado</span><span className="text-accent">{money(t.total)}</span></div>
        {sup && sup.payment_days > 0 && <p className="mt-2 text-xs text-mute">Condición del proveedor: pago a {sup.payment_days} días.</p>}
      </div>
      <label>Notas (opcional)<input name="notes" /></label>
      <div className="mt-2 flex gap-3 border-t border-line pt-5"><button className="btn btn-green">Crear orden en borrador</button><Link href={closeHref} className="btn btn-gray no-underline">Cancelar</Link></div>
    </form>
  );
}
