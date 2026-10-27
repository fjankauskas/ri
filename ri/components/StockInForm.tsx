"use client";
import { useState } from "react";
import Link from "next/link";
import { stockIn } from "@/app/actions";
import ScanButton from "./ScanButton";
import { dateValue } from "@/lib/gs1/ai";
import type { Resolved } from "@/lib/gs1/data";
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
/** Ingreso de stock: se puede escanear la etiqueta GS1 del producto (GTIN + lote + vencimiento + cantidad) y se completa solo. */
export default function StockInForm({ products, warehouses, selected, back, closeHref }: { products: { id: string; name: string; sku: string }[]; warehouses: { id: string; name: string }[]; selected?: string; back: string; closeHref: string }) {
  const [product, setProduct] = useState(selected && products.some((p) => p.id === selected) ? selected : products[0]?.id ?? "");
  const [lot, setLot] = useState(""), [qty, setQty] = useState(""), [expires, setExpires] = useState(""), [note, setNote] = useState(""), [info, setInfo] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const onCode = async (code: string) => {
    setInfo(null);
    try {
      const r: Resolved = await (await fetch(`/api/gs1/lookup?code=${encodeURIComponent(code)}`)).json();
      if (!r.elements?.length) return setInfo({ tone: "warn", text: r.errors?.[0] ?? "No se pudo interpretar el código." });
      const val = (ai: string) => r.elements.find((e) => e.ai === ai)?.value;
      const got: string[] = [];
      if (r.product) { setProduct(r.product.id); got.push(r.product.name); } else got.push("producto no encontrado (asignale ese GTIN en la sección GS1)");
      if (val("10")) { setLot(val("10")!); got.push(`lote ${val("10")}`); }
      const e17 = val("17") ?? val("15") ?? val("16");
      if (e17) { const d = dateValue(e17, "d6"); if (d.ok) { const [y, m, dd] = d.iso!.split("-").map(Number); setExpires(`${y}-${String(m).padStart(2, "0")}-${String(dd || lastDay(y, m)).padStart(2, "0")}`); got.push("vencimiento"); } }
      const q = val("37") ?? val("30"); if (q) { setQty(q); got.push(`${q} unidades`); }
      setInfo({ tone: r.product ? "ok" : "warn", text: `Leído: ${got.join(" · ")}` });
    } catch { setInfo({ tone: "warn", text: "No se pudo consultar el código." }); }
  };
  return (
    <form className="f" action={stockIn}>
      <input type="hidden" name="back" value={back} />
      <ScanButton onCode={onCode} label="📷 Escanear etiqueta GS1 (completa los datos)" className="btn btn-teal justify-self-start" />
      {info && <p className={`text-sm ${info.tone === "ok" ? "in" : "out"}`} role="status">{info.text}</p>}
      <div className="fgrid">
        <label className="full">Producto<select name="product" required value={product} onChange={(e) => setProduct(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></label>
        <label>Depósito<select name="warehouse">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <label>Lote<input name="lot" required value={lot} onChange={(e) => setLot(e.target.value)} /></label>
        <label>Cantidad<input name="qty" type="number" step="any" min="0" required value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label>Vencimiento (opcional)<input name="expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        <label>Tipo<select name="type"><option value="RECEIPT">Recepción / carga inicial</option><option value="ADJUSTMENT">Ajuste positivo (requiere motivo)</option></select></label>
        <label>Nota o motivo<input name="note" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="mt-2 flex gap-3 border-t border-line pt-5"><button className="btn btn-green">Registrar</button><Link href={closeHref} className="btn btn-gray no-underline">Cancelar</Link></div>
    </form>
  );
}
