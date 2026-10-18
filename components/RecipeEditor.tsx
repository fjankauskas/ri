"use client";
import { useState } from "react";
import { saveBom } from "@/app/actions";
type Prod = { id: string; sku: string; name: string; unit: string };
type Row = { component: string; qty: string };
// Editor de recetas con insumos ilimitados. Al elegir un producto que ya tiene receta, la carga para editarla.
export default function RecipeEditor({ prods, recipes, back, initial }: { prods: Prod[]; recipes: Record<string, Row[]>; back: string; initial?: string }) {
  const first = initial && prods.some((p) => p.id === initial) ? initial : prods[0]?.id ?? "";
  const load = (id: string): Row[] => (recipes[id]?.length ? recipes[id].map((r) => ({ ...r })) : [{ component: "", qty: "" }]);
  const [product, setProduct] = useState(first);
  const [rows, setRows] = useState<Row[]>(() => load(first));
  const exists = !!recipes[product]?.length;
  const upd = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const inputs = prods.filter((p) => p.id !== product);
  return (
    <form className="f" action={saveBom}>
      <input type="hidden" name="back" value={back} />
      <label>Producto terminado
        <select name="product" value={product} onChange={(e) => { setProduct(e.target.value); setRows(load(e.target.value)); }}>
          {prods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
        </select>
      </label>
      <span className="mu" style={{ fontSize: 13 }}>{exists ? "Este producto ya tiene receta: editala y guardá para reemplazarla." : "Insumos y cantidad necesaria por cada unidad producida."}</span>
      {rows.map((r, i) => (
        <div className="r3" key={i}>
          <select name="comp" value={r.component} onChange={(e) => upd(i, "component", e.target.value)} aria-label={`Insumo ${i + 1}`}>
            <option value="">— insumo {i + 1} —</option>
            {inputs.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku}) · {p.unit}</option>)}
          </select>
          <input name="qty" type="number" step="any" min="0" value={r.qty} onChange={(e) => upd(i, "qty", e.target.value)} placeholder="por u." aria-label={`Cantidad del insumo ${i + 1} por unidad`} />
          <button type="button" title="Quitar insumo" aria-label={`Quitar insumo ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => setRows((rs) => [...rs, { component: "", qty: "" }])}>＋ Agregar insumo</button>
      <button className="p">{exists ? "Guardar cambios de la receta" : "Guardar receta"}</button>
    </form>
  );
}
