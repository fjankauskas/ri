import { ctx } from "@/lib/ctx";
import Shell, { type SP } from "@/components/Shell";
import { ProduceForm } from "@/components/ProductionForms";
import RecipeEditor from "@/components/RecipeEditor";
import GtinField from "@/components/GtinField";
import { createProduct, createWarehouse, stockIn, moveStock, importStock, updateProduct, deleteProduct, adjustStock, deleteStock } from "../actions";
import { UNITS } from "@/lib/units";
import { n, day, posValue, posLabel, priceLabel } from "@/lib/format";

const POS = "quantity, reserved, warehouse_id, product_id, lot_id, warehouses(name), products(name, unit), lots(lot_number, expiration_date)";
// Opciones de la botonera lateral (ícono, etiqueta). El panel se abre al costado de la tabla.
const OPTS = [
  ["product", "🏷️", "Producto"], ["warehouse", "🏬", "Depósito"], ["stock", "📥", "Ingresar"], ["move", "🔀", "Mover"],
  ["import", "📄", "CSV"], ["produce", "🏭", "Producción"], ["trace", "🔎", "Trazar"],
] as const;
const TITLES: Record<string, string> = {
  product: "Nuevo producto", warehouse: "Nuevo depósito", stock: "Ingresar stock", move: "Transferir, ajustar o vender",
  import: "Importar stock (CSV)", produce: "Producción", trace: "Trazabilidad de lote", edit: "Editar producto y stock",
};

export default async function Products({ searchParams }: { searchParams: SP }) {
  const { sb, org, role } = await ctx();
  const { q = "", panel: rawPanel = "", edit = "", id: editId = "" } = await searchParams;
  const canWrite = role !== "VIEWER";
  const panel = canWrite && TITLES[rawPanel] ? rawPanel : "";
  const [prods, whs, pos, boms] = await Promise.all([
    sb.from("products").select("id, sku, name, unit, gtin, min_stock, price, price_per").eq("is_active", true).order("name"),
    sb.from("warehouses").select("id, name").eq("is_active", true).order("name"),
    sb.from("inventory_positions").select(POS).gt("quantity", 0),
    sb.from("bill_of_materials").select("id, product_id, products!product_id(name), bom_items(component_id, qty_per_unit)").eq("is_active", true),
  ]);
  const P = prods.data ?? [], W = whs.data ?? [], X = (pos.data as any[]) ?? [], B = (boms.data as any[]) ?? [];
  const recipes: Record<string, { component: string; qty: string }[]> = {};
  for (const b of B) recipes[b.product_id] = (b.bom_items ?? []).map((i: any) => ({ component: i.component_id, qty: String(i.qty_per_unit) }));
  const term = q.trim().toLowerCase();
  const shown = P.filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term));
  const stock = new Map<string, { qty: number; res: number; rows: any[] }>();
  for (const x of X) {
    const e = stock.get(x.product_id) ?? { qty: 0, res: 0, rows: [] };
    e.qty += Number(x.quantity); e.res += Number(x.reserved); e.rows.push(x); stock.set(x.product_id, e);
  }
  const href = (p: string) => {
    const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(panel === p ? {} : { panel: p }) }).toString();
    return "/products" + (qs ? "?" + qs : "");
  };
  const editing = P.find((p) => p.id === editId);
  const unitOpts = (cur?: string) => [...(cur && !(UNITS as readonly string[]).includes(cur) ? [cur] : []), ...UNITS].map((u) => <option key={u} value={u}>{u}{u === cur && !(UNITS as readonly string[]).includes(u) ? " (actual, no estándar)" : ""}</option>);
  const wopts = W.map((w) => <option key={w.id} value={w.id}>{w.name}</option>);
  const xopts = X.map((p) => <option key={posValue(p)} value={posValue(p)}>{posLabel(p)}</option>);
  const lots = Array.from(new Map(X.map((x) => [x.lot_id, x])).values());
  return (
    <Shell org={org.display_name} sp={searchParams}>
      {prods.error && <p role="alert" className="msg bad">No se pudieron leer los productos: {prods.error.message}. ¿Ejecutaste las migraciones 0004 y 0005 en Supabase?</p>}
      {boms.error && <p role="alert" className="msg bad">No se pudieron leer las recetas: {boms.error.message}</p>}
      <div className={`split${!canWrite ? " ro" : panel ? " open" : ""}`}>
        {canWrite && (
          <nav className="rail" aria-label="Opciones">
            {OPTS.map(([k, icon, label]) => <a key={k} href={href(k)} className={panel === k ? "on" : ""} title={TITLES[k]} aria-current={panel === k}><b aria-hidden>{icon}</b>{label}</a>)}
          </nav>
        )}
        <section>
          <form className="bar" action="/products" method="get">
            <input name="q" defaultValue={q} placeholder="Buscar por nombre o SKU…" aria-label="Buscar productos" />
            {panel && <input type="hidden" name="panel" value={panel} />}
            <button className="p">Buscar</button>
          </form>
          <table>
            <thead><tr><th>ID</th><th>Producto</th><th>SKU</th><th className="n">Cantidad</th><th className="n">Precio</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {shown.map((p) => {
                const s = stock.get(p.id), qty = s?.qty ?? 0, min = Number(p.min_stock ?? 0);
                const st = qty <= 0 ? ["Sin stock", "low"] : min > 0 && qty < min ? ["Stock bajo", "low"] : ["Disponible", "ok"];
                return (
                  <tr key={p.id}>
                    <td><code className="id">{String(p.id).slice(0, 6).toUpperCase()}</code></td>
                    <td>{p.name}</td><td>{p.sku}</td>
                    <td className="n">{n(qty)} {p.unit}{s && s.res > 0 && <div className="mu">reservado {n(s.res)}</div>}</td>
                    <td className="n">{p.price == null ? "—" : priceLabel(p.price, p.price_per, p.unit)}</td>
                    <td><span className={`tag ${st[1]}`}>{st[0]}</span></td>
                    <td>{canWrite && <a href={`/products?panel=edit&id=${p.id}${q ? "&q=" + encodeURIComponent(q) : ""}`}>Editar</a>}</td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={7} className="mu">{P.length ? "Ningún producto coincide con la búsqueda." : "Todavía no tenés productos. Usá la opción «Producto» o «CSV» del costado para empezar."}</td></tr>}
            </tbody>
          </table>
        </section>
        {panel && (
          <section>
            <div className="head"><h2>{TITLES[panel]}</h2><a href={href(panel)} aria-label="Cerrar panel">✕</a></div>
            {panel === "product" && <form className="f" action={createProduct}>
              <label>SKU<input name="sku" required /></label><label>Nombre<input name="name" required /></label>
              <label>Unidad de medida<select name="unit" defaultValue="u" required>{unitOpts()}</select></label>
              <label>Precio ($, opcional)<input name="price" type="number" step="0.01" min="0" /></label>
              <label>…por cuántas unidades de medida<input name="price_per" type="number" step="any" min="0" defaultValue="1" /></label>
              <p className="mu" style={{ margin: 0 }}>Ej.: $200.000 por 1000 kg. Quien compre verá ese precio y el total según la cantidad que pida.</p>
              <GtinField />
              <label>Stock mínimo para alertar (opcional)<input name="min_stock" type="number" step="any" min="0" defaultValue="0" /></label>
              <h2 style={{ fontSize: 14, marginTop: 8 }}>Stock inicial (opcional)</h2>
              <label>Cantidad<input name="qty" type="number" step="any" min="0" placeholder="0" /></label>
              <label>Depósito<select name="warehouse">{wopts}</select></label>
              <label>Lote<input name="lot" defaultValue="INICIAL" /></label>
              <label>Vencimiento (opcional)<input name="expires" type="date" /></label>
              <button className="p">Crear producto</button></form>}
            {panel === "warehouse" && <><form className="f" action={createWarehouse}>
              <label>Nombre<input name="name" required /></label><button className="p">Crear depósito</button></form>
              <p className="mu">Depósitos: {W.map((w) => w.name).join(", ") || "ninguno todavía"}</p></>}
            {panel === "stock" && <form className="f" action={stockIn}>
              <label>Producto<select name="product" required>{P.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></label>
              <label>Depósito<select name="warehouse">{wopts}</select></label><label>Lote<input name="lot" required /></label>
              <label>Vencimiento (opcional)<input name="expires" type="date" /></label>
              <label>Cantidad<input name="qty" type="number" step="any" min="0" required /></label>
              <label>Tipo<select name="type"><option value="RECEIPT">Recepción / carga inicial</option><option value="ADJUSTMENT">Ajuste positivo (requiere motivo)</option></select></label>
              <label>Nota o motivo<input name="note" /></label><button className="p">Registrar</button></form>}
            {panel === "move" && <form className="f" action={moveStock}>
              <label>Existencia<select name="position" required>{xopts}</select></label>
              <label>Operación<select name="type"><option value="TRANSFER">Transferir a otro depósito</option><option value="ADJUSTMENT">Ajuste negativo (requiere motivo)</option><option value="SALE">Venta a consumidor</option></select></label>
              <label>Destino (solo transferencia)<select name="to"><option value="">—</option>{wopts}</select></label>
              <label>Cantidad<input name="qty" type="number" step="any" min="0" required /></label><label>Motivo<input name="note" /></label>
              <button className="p">Registrar</button></form>}
            {panel === "import" && <form className="f" action={importStock}>
              <label>Depósito<select name="warehouse">{wopts}</select></label>
              <label>Archivo CSV<input type="file" name="file" accept=".csv,.txt,text/csv" /></label>
              <label>…o pegá las filas<textarea name="csv" rows={4} placeholder={"sku,lote,cantidad,vencimiento\nHAR,H-500,2000,2027-03-01"} /></label>
              <label className="mu" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="create_missing" style={{ width: "auto" }} /> Crear los productos que no existan (usa las columnas nombre y unidad si vienen)</label>
              <p className="mu">Columnas: sku, lote, cantidad (obligatorias); vencimiento, nombre, unidad (opcionales). Acepta «;» o «,», decimales con coma y fechas AAAA-MM-DD o DD/MM/AAAA. Máximo 2000 filas; si una fila falla no se carga nada. <a href={"data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFFsku,lote,cantidad,vencimiento,nombre,unidad\r\nHAR,H-500,2000,2027-03-01,Harina 000,kg\r\n")} download="plantilla-stock.csv">Descargar plantilla</a></p>
              <button className="p">Importar todo o nada</button></form>}
            {panel === "produce" && <>
              <h2 style={{ fontSize: 14 }}>Producir</h2><ProduceForm boms={B} whs={W} back="/products" />
              <h2 style={{ fontSize: 14, marginTop: 16 }}>Receta (BOM)</h2>
              <RecipeEditor key={edit || "nuevo"} prods={P} recipes={recipes} back="/products" initial={edit} />
              <h2 style={{ fontSize: 14, marginTop: 16 }}>Recetas activas</h2>
              {B.map((b) => <p key={b.id} className="mu" style={{ margin: "4px 0" }}><b>{b.products.name}</b> · {(b.bom_items ?? []).length} insumo(s) · <a href={`/products?panel=produce&edit=${b.product_id}`}>Editar</a></p>)}
              {!B.length && <p className="mu">Todavía no hay recetas.</p>}
              <p className="mu"><a href="/production">Ver detalle completo</a></p></>}
            {panel === "edit" && (editing ? <>
              <h2 style={{ fontSize: 14 }}>{editing.name}</h2>
              <form className="f" action={updateProduct}>
                <input type="hidden" name="id" value={editing.id} /><input type="hidden" name="unit_current" value={editing.unit} />
                <label>SKU<input name="sku" defaultValue={editing.sku} required /></label>
                <label>Nombre<input name="name" defaultValue={editing.name} required /></label>
                <label>Unidad de medida<select name="unit" defaultValue={editing.unit}>{unitOpts(editing.unit)}</select></label>
                <label>Precio ($)<input name="price" type="number" step="0.01" min="0" defaultValue={editing.price ?? ""} /></label>
                <label>…por cuántas unidades de medida<input name="price_per" type="number" step="any" min="0" defaultValue={editing.price_per ?? 1} /></label>
                <GtinField key={editing.id} initial={editing.gtin ?? ""} />
                <label>Stock mínimo para alertar<input name="min_stock" type="number" step="any" min="0" defaultValue={editing.min_stock ?? 0} /></label>
                <p className="mu" style={{ margin: 0 }}>Cambiar la unidad no convierte las cantidades que ya tenés cargadas.</p>
                <button className="p">Guardar cambios</button></form>
              <h2 style={{ fontSize: 14, marginTop: 18 }}>Stock por lote</h2>
              {(stock.get(editing.id)?.rows ?? []).map((x) => (
                <form key={posValue(x)} className="f lotf" action={adjustStock}>
                  <input type="hidden" name="position" value={posValue(x)} />
                  <div className="mu">{x.warehouses.name} · lote <a href={`/trace?lot=${x.lot_id}`}>{x.lots.lot_number}</a>{x.lots.expiration_date ? ` · vence ${day(x.lots.expiration_date)}` : ""}<br />Hay {n(x.quantity)} {editing.unit}{Number(x.reserved) > 0 ? ` (reservado ${n(x.reserved)})` : ""}</div>
                  <label>Cantidad correcta<input name="qty" type="number" step="any" min="0" defaultValue={Number(x.quantity)} required /></label>
                  <label>Motivo (queda en el historial)<input name="note" required placeholder="Conteo físico, rotura, error de carga…" /></label>
                  <div style={{ display: "flex", gap: 6 }}><button className="p">Corregir cantidad</button><button className="danger" formAction={deleteStock}>Eliminar stock</button></div>
                </form>
              ))}
              {!stock.get(editing.id) && <p className="mu">Sin stock. Usá «Ingresar» para cargar.</p>}
              <h2 style={{ fontSize: 14, marginTop: 18 }}>Eliminar producto</h2>
              <form className="f" action={deleteProduct}>
                <input type="hidden" name="id" value={editing.id} />
                <label className="mu" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="confirm" style={{ width: "auto" }} required /> Confirmo que quiero eliminarlo</label>
                <button className="danger">Eliminar producto</button></form>
              <p className="mu">Solo se puede eliminar si no tiene stock, pedidos en curso ni recetas que lo usen. El historial se conserva.</p></>
              : <p className="mu">No se encontró ese producto.</p>)}
            {panel === "trace" && <>
              <form className="f" action="/trace" method="get">
                <label>Lote en stock<select name="lot" required>{lots.map((x) => <option key={x.lot_id} value={x.lot_id}>{x.products.name} · {x.lots.lot_number}</option>)}</select></label>
                <button className="p" disabled={!lots.length}>Ver recorrido</button></form>
              <p className="mu">También podés tocar el número de lote en «Detalle» de cada producto. Para lotes sin stock usá la pantalla <a href="/trace">Trazabilidad</a>.</p></>}
          </section>
        )}
      </div>
    </Shell>
  );
}
