"use client";
import { useState } from "react";
import Link from "next/link";
import { registerInvoice } from "@/app/purchases-actions";
import { money } from "@/lib/format";
export type PendingReceipt = { id: string; label: string; expected: number };
/** Factura del proveedor: tildás las recepciones que cubre y la app te dice cuánto debería sumar (neto) según lo que recibiste. */
export default function SupplierInvoiceForm({ supplier, receipts, back, closeHref }: { supplier: string; receipts: PendingReceipt[]; back: string; closeHref: string }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [net, setNet] = useState(""), [iva, setIva] = useState(""), [total, setTotal] = useState("");
  const expected = Math.round(receipts.filter((r) => sel.has(r.id)).reduce((a, r) => a + r.expected, 0) * 100) / 100;
  const n = (x: string) => Number(x.replace(",", ".")) || 0;
  const toggle = (id: string) => setSel((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const diff = net ? Math.round((n(net) - expected) * 100) / 100 : null;
  return (
    <form className="f" action={registerInvoice}>
      <input type="hidden" name="back" value={back} /><input type="hidden" name="supplier" value={supplier} />
      <div className="fgrid">
        <label>Tipo<select name="doc_type" defaultValue="A">{["A", "B", "C", "M", "X", "NC", "ND", "OTRO"].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>Punto de venta<input name="pto_vta" type="number" min="0" placeholder="0001" /></label>
        <label>Número<input name="number" type="number" min="1" required /></label>
        <label>Fecha de la factura<input name="invoice_date" type="date" required /></label>
        <label>Vencimiento (opcional)<input name="due_date" type="date" /></label>
        <label>CAE (opcional)<input name="cae" inputMode="numeric" /></label>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Recepciones que cubre esta factura</p>
        {receipts.map((r) => <label key={r.id} className="flex items-start gap-2 rounded-lg border border-line p-3 font-normal"><input type="checkbox" name="receipt" value={r.id} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="mt-1" /><span className="text-sm">{r.label}<span className="block text-mute">Neto esperado: {money(r.expected)}</span></span></label>)}
        {!receipts.length && <p className="text-sm text-mute">Este proveedor no tiene recepciones sin factura. Podés cargar la factura igual y vincularla después no es posible: registrá primero la recepción.</p>}
      </div>
      <div className="fgrid">
        <label>Neto<input name="total_net" type="number" step="0.01" min="0" required value={net} onChange={(e) => { setNet(e.target.value); setTotal(String(Math.round((n(e.target.value) + n(iva)) * 100) / 100)); }} /></label>
        <label>IVA<input name="total_iva" type="number" step="0.01" min="0" value={iva} onChange={(e) => { setIva(e.target.value); setTotal(String(Math.round((n(net) + n(e.target.value)) * 100) / 100)); }} /></label>
        <label className="full">Total<input name="total" type="number" step="0.01" min="0" required value={total} onChange={(e) => setTotal(e.target.value)} /></label>
      </div>
      {sel.size > 0 && <div className="rounded-lg border border-line bg-surface p-3 text-sm">
        <p>Neto esperado de lo recibido: <b>{money(expected)}</b> <button type="button" className="btn btn-gray btn-sm ml-2" onClick={() => { setNet(String(expected)); setTotal(String(Math.round((expected + n(iva)) * 100) / 100)); }}>Usar este neto</button></p>
        {diff != null && <p className={Math.abs(diff) < 0.05 ? "in" : "out"}>{Math.abs(diff) < 0.05 ? "✔ El neto de la factura coincide con lo recibido." : `La factura difiere en ${money(diff)} respecto de lo recibido: revisá precios o cantidades.`}</p>}
      </div>}
      <label>Notas (opcional)<input name="notes" /></label>
      <div className="mt-2 flex gap-3 border-t border-line pt-5"><button className="btn btn-green">Registrar factura</button><Link href={closeHref} className="btn btn-gray no-underline">Cancelar</Link></div>
    </form>
  );
}
