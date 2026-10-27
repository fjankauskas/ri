import Link from "next/link";
import Modal from "@/components/Modal";
import GtinField from "@/components/GtinField";
import StockInForm from "@/components/StockInForm";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, FormFooter, Empty, type PillTone } from "@/components/ui";
import { createProduct, createWarehouse, stockIn, moveStock, importStock, updateProduct, deleteProduct, adjustStock, deleteStock } from "@/app/actions";
import { UNITS } from "@/lib/units";
import { IVA_OPTIONS } from "@/lib/billing";
import { n, day, posValue, posLabel, priceLabel } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const POS = "quantity, reserved, warehouse_id, product_id, lot_id, warehouses(name), products(name, unit), lots(lot_number, expiration_date)";
const ST: Record<string, [string, PillTone]> = { none: ["Sin stock", "red"], low: ["Stock bajo", "amber"], ok: ["Disponible", "green"] };
const FILTERS: [string, string][] = [["all", "Todos"], ["ok", "Disponible"], ["low", "Stock bajo"], ["none", "Sin stock"]];
const TEMPLATE = "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFFsku,lote,cantidad,vencimiento,nombre,unidad\r\nHAR,H-500,2000,2027-03-01,Harina 000,kg\r\n");

export default async function ProductsView({ sb, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/inventory", { ...P, v: "products" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), f = P.f ?? "all", sel = P.id ?? "", modal = P.modal ?? "";
  const canWrite = role !== "VIEWER";
  const [prods, whs, pos, boms] = await Promise.all([
    sb.from("products").select("id, sku, name, unit, gtin, min_stock, price, price_per, iva").eq("is_active", true).order("name"),
    sb.from("warehouses").select("id, name").eq("is_active", true).order("name"),
    sb.from("inventory_positions").select(POS).gt("quantity", 0),
    sb.from("bill_of_materials").select("id, product_id").eq("is_active", true),
  ]);
  const PR = (prods.data as any[]) ?? [], W = (whs.data as any[]) ?? [], X = (pos.data as any[]) ?? [], B = (boms.data as any[]) ?? [];
  const stock = new Map<string, { qty: number; res: number; rows: any[] }>();
  for (const x of X) {
    const e = stock.get(x.product_id) ?? { qty: 0, res: 0, rows: [] };
    e.qty += Number(x.quantity); e.res += Number(x.reserved); e.rows.push(x); stock.set(x.product_id, e);
  }
  const rows = PR.map((p) => {
    const s = stock.get(p.id), qty = s?.qty ?? 0, min = Number(p.min_stock ?? 0);
    return { p, qty, res: s?.res ?? 0, st: qty <= 0 ? "none" : min > 0 && qty < min ? "low" : "ok" };
  }).filter((r) => (!q || r.p.name.toLowerCase().includes(q) || r.p.sku.toLowerCase().includes(q)) && (f === "all" || r.st === f));
  const back = L({ modal: null });
  const editing = PR.find((p) => p.id === sel);
  const hasRecipe = (id: string) => B.some((b) => b.product_id === id);
  const wopts = W.map((w) => <option key={w.id} value={w.id}>{w.name}</option>);
  const unitOpts = (cur?: string) => [...(cur && !(UNITS as readonly string[]).includes(cur) ? [cur] : []), ...UNITS].map((u) => <option key={u} value={u}>{u}{u === cur && !(UNITS as readonly string[]).includes(u) ? " (actual, no estándar)" : ""}</option>);
  const hidden = <input type="hidden" name="back" value={back} />;

  const main = (
    <div>
      {prods.error && <p role="alert" className="mb-4 text-bad">No se pudieron leer los productos: {prods.error.message}. ¿Ejecutaste las migraciones 0004, 0005 y 0006 en Supabase?</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/inventory" keep={{ v: "products", f: f === "all" ? undefined : f }} q={P.q} placeholder="Buscar por nombre o SKU…" />
        <FilterMenu label="Estado" value={f} options={FILTERS.map(([key, label]) => ({ key, label, href: L({ f: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>ID</th><th>Producto</th><th>SKU</th><th className="n">Cantidad</th><th className="n">Precio</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.map(({ p, qty, res, st }) => (
            <tr key={p.id} aria-selected={sel === p.id}>
              <td><code className="font-mono text-xs text-mute">{String(p.id).slice(0, 6).toUpperCase()}</code></td>
              <td className="k">{p.name}</td><td>{p.sku}</td>
              <td className="n">{n(qty)} {p.unit}{res > 0 && <div className="text-xs text-mute">reservado {n(res)}</div>}</td>
              <td className="n">{p.price == null ? "—" : priceLabel(p.price, p.price_per, p.unit)}</td>
              <td><Pill tone={ST[st][1]}>{ST[st][0]}</Pill></td>
              <td className="n">{canWrite && <Link href={L({ id: p.id, modal: null })}>Editar</Link>}</td>
            </tr>
          ))}
          {!rows.length && <Empty cols={7}>{PR.length ? "Ningún producto coincide con la búsqueda o el filtro." : "Todavía no tenés productos. Usá «Nuevo producto» o «Importar CSV» a la derecha para empezar."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">{rows.length} de {PR.length} productos</p>

      {canWrite && modal === "product" && (
        <Modal title="Nuevo producto" closeHref={back} wide>
          <form className="f" action={createProduct}>
            {hidden}
            <div className="fgrid">
              <label>SKU<input name="sku" required autoFocus /></label>
              <label>Nombre<input name="name" required /></label>
              <label>Unidad de medida<select name="unit" defaultValue="u" required>{unitOpts()}</select></label>
              <label>Precio ($, opcional)<input name="price" type="number" step="0.01" min="0" /></label>
              <label>…por cuántas unidades de medida<input name="price_per" type="number" step="any" min="0" defaultValue="1" /></label>
              <label>IVA de venta<select name="iva" defaultValue="21">{IVA_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
              <label>Stock mínimo para alertar<input name="min_stock" type="number" step="any" min="0" defaultValue="0" /></label>
              <div className="full"><GtinField /></div>
            </div>
            <p className="text-sm text-mute">Ej.: $200.000 por 1000 kg (precio sin IVA). Quien compre verá ese precio y el total según la cantidad que pida.</p>
            <h3 className="pt-2">Stock inicial (opcional)</h3>
            <div className="fgrid">
              <label>Cantidad<input name="qty" type="number" step="any" min="0" placeholder="0" /></label>
              <label>Depósito<select name="warehouse">{wopts}</select></label>
              <label>Lote<input name="lot" defaultValue="INICIAL" /></label>
              <label>Vencimiento (opcional)<input name="expires" type="date" /></label>
            </div>
            <FormFooter submit="Crear producto" closeHref={back} />
          </form>
        </Modal>
      )}
      {canWrite && modal === "warehouse" && (
        <Modal title="Nuevo depósito" closeHref={back}>
          <form className="f" action={createWarehouse}>
            {hidden}
            <label>Nombre<input name="name" required autoFocus /></label>
            <p className="text-sm text-mute">Depósitos actuales: {W.map((w) => w.name).join(", ") || "ninguno todavía"}.</p>
            <FormFooter submit="Crear depósito" closeHref={back} />
          </form>
        </Modal>
      )}
      {canWrite && modal === "stock" && (
        <Modal title="Ingresar stock" closeHref={back} wide>
          <StockInForm products={PR} warehouses={W} selected={sel} back={back} closeHref={back} />
        </Modal>
      )}
      {canWrite && modal === "move" && (
        <Modal title="Transferir, ajustar o vender" closeHref={back} wide>
          <form className="f" action={moveStock}>
            {hidden}
            <div className="fgrid">
              <label className="full">Existencia<select name="position" required>{X.map((p) => <option key={posValue(p)} value={posValue(p)}>{posLabel(p)}</option>)}</select></label>
              <label>Operación<select name="type"><option value="TRANSFER">Transferir a otro depósito</option><option value="ADJUSTMENT">Ajuste negativo (requiere motivo)</option><option value="SALE">Venta a consumidor</option></select></label>
              <label>Cantidad<input name="qty" type="number" step="any" min="0" required /></label>
              <label>Destino (solo transferencia)<select name="to"><option value="">—</option>{wopts}</select></label>
              <label>Motivo<input name="note" /></label>
            </div>
            <FormFooter submit="Registrar" closeHref={back} />
          </form>
        </Modal>
      )}
      {canWrite && modal === "import" && (
        <Modal title="Importar stock (CSV)" closeHref={back} wide>
          <form className="f" action={importStock}>
            {hidden}
            <label>Depósito<select name="warehouse">{wopts}</select></label>
            <label>Archivo CSV<input type="file" name="file" accept=".csv,.txt,text/csv" /></label>
            <label>…o pegá las filas<textarea name="csv" rows={4} placeholder={"sku,lote,cantidad,vencimiento\nHAR,H-500,2000,2027-03-01"} /></label>
            <label className="flex items-center gap-2 font-normal text-mute"><input type="checkbox" name="create_missing" /> Crear los productos que no existan (usa las columnas nombre y unidad si vienen)</label>
            <p className="text-sm text-mute">Columnas: sku, lote, cantidad (obligatorias); vencimiento, nombre, unidad (opcionales). Acepta «;» o «,», decimales con coma y fechas AAAA-MM-DD o DD/MM/AAAA. Máximo 2000 filas; si una fila falla no se carga nada. <a href={TEMPLATE} download="plantilla-stock.csv">Descargar plantilla</a></p>
            <FormFooter submit="Importar todo o nada" closeHref={back} />
          </form>
        </Modal>
      )}
    </div>
  );

  const stockOf = editing ? stock.get(editing.id) : undefined;
  const aside = canWrite ? (
    <>
      <Card title="Acciones" sub="Qué podés hacer con tu stock.">
        <div className="grid gap-2">
          <ActionLink href={L({ modal: "product", id: null })} icon="plus">Nuevo producto</ActionLink>
          <ActionLink href={L({ modal: "stock" })} icon="upload" tone="teal">Ingresar stock</ActionLink>
          <ActionLink href={L({ modal: "move" })} icon="swap" tone="cyan">Transferir o ajustar</ActionLink>
          <ActionLink href={L({ modal: "import", id: null })} icon="export" tone="gray">Importar CSV</ActionLink>
          <ActionLink href={L({ modal: "warehouse" })} icon="partners" tone="gray">Nuevo depósito</ActionLink>
        </div>
      </Card>
      {editing && (
        <Card title={`Editar: ${editing.name}`}>
          <form className="f" action={updateProduct}>
            {hidden}
            <input type="hidden" name="id" value={editing.id} /><input type="hidden" name="unit_current" value={editing.unit} />
            <label>SKU<input name="sku" defaultValue={editing.sku} required /></label>
            <label>Nombre<input name="name" defaultValue={editing.name} required /></label>
            <label>Unidad de medida<select name="unit" defaultValue={editing.unit}>{unitOpts(editing.unit)}</select></label>
            <div className="fgrid">
              <label>Precio ($)<input name="price" type="number" step="0.01" min="0" defaultValue={editing.price ?? ""} /></label>
              <label>…por cuántas {editing.unit}<input name="price_per" type="number" step="any" min="0" defaultValue={editing.price_per ?? 1} /></label>
            </div>
            <label>IVA de venta<select name="iva" defaultValue={editing.iva ?? "21"}>{IVA_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
            <GtinField key={editing.id} initial={editing.gtin ?? ""} />
            <label>Stock mínimo para alertar<input name="min_stock" type="number" step="any" min="0" defaultValue={editing.min_stock ?? 0} /></label>
            <p className="text-xs text-mute">Cambiar la unidad no convierte las cantidades que ya tenés cargadas.</p>
            <button className="btn btn-green">Guardar cambios</button>
          </form>
          <div className="mt-5 grid gap-2 border-t border-line pt-4 text-sm">
            <Link href={`/inventory?v=production&edit=${editing.id}`}>{hasRecipe(editing.id) ? "Editar su receta" : "Crear su receta"} →</Link>
            <Link href={`/network?v=market&pub=${editing.id}`}>Publicar en la red →</Link>
          </div>
          <h3 className="mt-5 border-t border-line pt-4">Stock por lote</h3>
          {(stockOf?.rows ?? []).map((x) => (
            <form key={posValue(x)} className="f lotf" action={adjustStock}>
              {hidden}
              <input type="hidden" name="position" value={posValue(x)} />
              <div className="text-sm text-mute">{x.warehouses.name} · lote <Link href={`/inventory?v=trace&lot=${x.lot_id}`}>{x.lots.lot_number}</Link>{x.lots.expiration_date ? ` · vence ${day(x.lots.expiration_date)}` : ""}<br />Hay {n(x.quantity)} {editing.unit}{Number(x.reserved) > 0 ? ` (reservado ${n(x.reserved)})` : ""}</div>
              <label>Cantidad correcta<input name="qty" type="number" step="any" min="0" defaultValue={Number(x.quantity)} required /></label>
              <label>Motivo (queda en el historial)<input name="note" required placeholder="Conteo físico, rotura, error de carga…" /></label>
              <div className="flex gap-2"><button className="btn btn-green btn-sm">Corregir cantidad</button><button className="btn btn-red btn-sm" formAction={deleteStock}>Eliminar stock</button></div>
            </form>
          ))}
          {!stockOf && <p className="mt-2 text-sm text-mute">Sin stock. Usá «Ingresar stock» para cargar.</p>}
          <h3 className="mt-5 border-t border-line pt-4">Eliminar producto</h3>
          <form className="f mt-2" action={deleteProduct}>
            {hidden}
            <input type="hidden" name="id" value={editing.id} />
            <label className="flex items-center gap-2 font-normal text-mute"><input type="checkbox" name="confirm" required /> Confirmo que quiero eliminarlo</label>
            <button className="btn btn-red">Eliminar producto</button>
          </form>
          <p className="mt-2 text-xs text-mute">Solo se puede eliminar si no tiene stock, pedidos en curso ni recetas que lo usen. El historial se conserva.</p>
        </Card>
      )}
    </>
  ) : undefined;
  return { title: "Productos y stock", intro: "Todo tu catálogo con su stock y precio. Elegí un producto para editarlo o corregir su stock.", main, aside };
}
