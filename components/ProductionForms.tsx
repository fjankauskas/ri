import { produce } from "@/app/actions";
// Formularios de Producción compartidos por «Productos y stock» y la pantalla Producción.
export function ProduceForm({ boms, whs, back, selected }: { boms: any[]; whs: any[]; back: string; selected?: string }) {
  return (
    <form className="f" action={produce}>
      <input type="hidden" name="back" value={back} />
      <label>Producto<select name="product" defaultValue={selected}>{boms.map((b) => <option key={b.id} value={b.product_id}>{b.products.name}</option>)}</select></label>
      <label>Depósito<select name="warehouse">{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <label>Cantidad<input name="qty" type="number" step="any" min="0" required /></label>
      <label>Lote<input name="lot" required /></label>
      <label>Vencimiento (opcional)<input name="expires" type="date" /></label>
      <button className="p" disabled={!boms.length}>Producir</button>
      <p className="mu">{boms.length ? "Consume primero los insumos que vencen antes. Si falta algo, te dice qué y cuánto." : "Primero guardá una receta para poder producir."}</p>
    </form>
  );
}
