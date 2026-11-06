import Link from "next/link";
import Modal from "@/components/Modal";
import PoForm from "@/components/PoForm";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, Empty, type PillTone } from "@/components/ui";
import { approvePo, cancelPo, receivePo } from "@/app/purchases-actions";
import { myPerms } from "@/lib/perms-server";
import { computeTotals, cbteNumber, CBTE } from "@/lib/billing";
import { money, n, day } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const ST: Record<string, [string, PillTone]> = { DRAFT: ["Borrador", "gray"], APPROVED: ["Autorizada", "blue"], PARTIAL: ["Recepción parcial", "amber"], RECEIVED: ["Recibida", "green"], CANCELLED: ["Cancelada", "gray"] };
const FILTERS: [string, string][] = [["all", "Todas"], ["open", "Abiertas"], ["DRAFT", "Borradores"], ["APPROVED", "Autorizadas"], ["PARTIAL", "Recepción parcial"], ["RECEIVED", "Recibidas"], ["CANCELLED", "Canceladas"]];
const po = (x: number) => `OC-${String(x).padStart(4, "0")}`;
const totalOf = (items: any[]) => computeTotals(items.map((i) => ({ qty: Number(i.qty_ordered), unit_price: Number(i.unit_price), iva: i.iva })), "RI").total;

export default async function OrdersView({ sb, org, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/commerce", { ...P, v: "purchases" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), f = P.f ?? "all", sel = P.po ?? "", modal = P.modal ?? "", perms = await myPerms(sb, org.id, role);
  const [{ data: pos, error }, { data: its }] = await Promise.all([
    sb.from("purchase_orders").select("id, number, status, order_date, expected_date, supplier_id, notes, suppliers(name)").order("number", { ascending: false }).limit(200),
    sb.from("purchase_order_items").select("po_id, qty_ordered, qty_received, unit_price, iva"),
  ]);
  const PO = (pos as any[]) ?? [], IT = (its as any[]) ?? [];
  const rows = PO.map((o) => { const items = IT.filter((i) => i.po_id === o.id), ord = items.reduce((a, i) => a + Number(i.qty_ordered), 0), rec = items.reduce((a, i) => a + Number(i.qty_received), 0); return { o, total: totalOf(items), pct: ord ? Math.round((rec / ord) * 100) : 0 }; })
    .filter((r) => (!q || r.o.suppliers?.name.toLowerCase().includes(q) || po(r.o.number).toLowerCase().includes(q)) && (f === "all" || (f === "open" ? ["DRAFT", "APPROVED", "PARTIAL"].includes(r.o.status) : r.o.status === f)));
  const back = L({ modal: null });
  const hidden = <input type="hidden" name="back" value={back} />;
  const cur = PO.find((o) => o.id === sel);
  let detail: any = null;
  if (cur) {
    const [{ data: items }, { data: recs }, { data: whs }] = await Promise.all([
      sb.from("purchase_order_items").select("id, qty_ordered, qty_received, unit_price, iva, products(name, sku, unit)").eq("po_id", cur.id).order("id"),
      sb.from("purchase_receipts").select("id, receipt_date, note, purchase_receipt_items(qty, lot_number, expiration_date, products(name, unit)), supplier_invoice_receipts(supplier_invoices(doc_type, pto_vta, number))").eq("po_id", cur.id).order("created_at", { ascending: false }),
      sb.from("warehouses").select("id, name").eq("is_active", true).order("name"),
    ]);
    detail = { items: (items as any[]) ?? [], recs: (recs as any[]) ?? [], whs: (whs as any[]) ?? [] };
  }
  let form: any = null;
  if (modal === "new" && perms.can("purchases", "create")) {
    const [{ data: sup }, { data: prods }, { data: pp }] = await Promise.all([
      sb.from("suppliers").select("id, name, payment_days").eq("is_active", true).order("name"), sb.from("products").select("id, name, sku, unit, iva").eq("is_active", true).order("name"),
      sb.from("purchase_prices").select("supplier_id, product_id, unit_price, quoted_at, created_at").order("quoted_at", { ascending: false }).order("created_at", { ascending: false }).limit(3000),
    ]);
    const last: Record<string, Record<string, number>> = {};
    for (const p of (pp as any[]) ?? []) { last[p.supplier_id] ??= {}; if (last[p.supplier_id][p.product_id] == null) last[p.supplier_id][p.product_id] = Number(p.unit_price); }
    form = { sup: (sup as any[]) ?? [], prods: (prods as any[]) ?? [], last };
  }
  const main = (
    <div>
      {error && <p role="alert" className="mb-4 text-bad">No se pudieron leer las órdenes: {error.message}. ¿Ejecutaste la migración 0009?</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/commerce" keep={{ v: "purchases", f: f === "all" ? undefined : f }} q={P.q} placeholder="Buscar por proveedor o número…" />
        <FilterMenu label="Estado" value={f} options={FILTERS.map(([key, label]) => ({ key, label, href: L({ f: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Orden</th><th>Proveedor</th><th>Fecha</th><th>Entrega</th><th className="n">Total</th><th>Recibido</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.map(({ o, total, pct }) => (
            <tr key={o.id} aria-selected={sel === o.id}>
              <td className="k">{po(o.number)}</td><td>{o.suppliers?.name}</td><td>{day(o.order_date)}</td><td>{day(o.expected_date)}</td><td className="n">{money(total)}</td>
              <td><div className="flex items-center gap-2"><div className="h-2 w-20 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div><span className="text-xs text-mute">{pct}%</span></div></td>
              <td><Pill tone={ST[o.status][1]}>{ST[o.status][0]}</Pill></td>
              <td><div className="flex items-center justify-end gap-3">
                {o.status === "DRAFT" && perms.can("purchases", "approve") && <form action={approvePo}>{hidden}<input type="hidden" name="po" value={o.id} /><button className="btn btn-green btn-sm">Autorizar</button></form>}
                <Link href={L({ po: o.id, modal: null })} className="text-sm">{["APPROVED", "PARTIAL"].includes(o.status) ? "Recibir" : "Detalle"}</Link>
              </div></td>
            </tr>
          ))}
          {!rows.length && <Empty cols={8}>{PO.length ? "Ninguna orden coincide con la búsqueda o el filtro." : "Todavía no hay órdenes de compra. Creá una con «Nueva orden» a la derecha."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">{rows.length} de {PO.length} órdenes. Flujo: borrador → autorizada → recepciones (totales o parciales) → factura del proveedor.</p>
      {form && (
        <Modal title="Nueva orden de compra" closeHref={back} wide>
          {form.sup.length && form.prods.length ? <PoForm suppliers={form.sup} products={form.prods} last={form.last} back={back} closeHref={back} initialSupplier={P.supplier} />
            : <p className="text-mute">Para comprar necesitás al menos un proveedor y un producto. Cargá un proveedor en <Link href="/commerce?v=suppliers&modal=supplier">Proveedores</Link>.</p>}
        </Modal>
      )}
    </div>
  );
  const aside = (
    <>
      {perms.can("purchases", "create") && <Card title="Acciones" sub="Reposición de mercadería."><div className="grid gap-2"><ActionLink href={L({ modal: "new", po: null })} icon="plus">Nueva orden de compra</ActionLink><ActionLink href="/commerce?v=suppliers" icon="partners" tone="gray">Proveedores</ActionLink><ActionLink href="/commerce?v=prices" icon="summary" tone="gray">Comparar precios</ActionLink></div></Card>}
      {cur && detail && (
        <Card title={`${po(cur.number)} · ${cur.suppliers?.name}`} sub={`${ST[cur.status][0]} · pedida el ${day(cur.order_date)}`}>
          <table className="w-full text-sm"><thead><tr className="text-left text-mute"><th className="pb-2 font-normal">Producto</th><th className="pb-2 text-right font-normal">Pedido</th><th className="pb-2 text-right font-normal">Recibido</th><th className="pb-2 text-right font-normal">Precio</th></tr></thead><tbody>
            {detail.items.map((i: any) => <tr key={i.id} className="border-t border-line"><td className="py-2">{i.products.name}</td><td className="py-2 text-right">{n(i.qty_ordered)} {i.products.unit}</td><td className="py-2 text-right">{n(i.qty_received)}</td><td className="py-2 text-right">{money(i.unit_price)}</td></tr>)}
          </tbody></table>
          <div className="mt-3 flex justify-between border-t border-line pt-3 font-medium"><span>Total con IVA</span><span>{money(totalOf(detail.items.map((i: any) => ({ qty_ordered: i.qty_ordered, unit_price: i.unit_price, iva: i.iva }))))}</span></div>
          {cur.notes && <p className="mt-2 text-sm text-mute">{cur.notes}</p>}
          <div className="mt-4 grid gap-2">
            {cur.status === "DRAFT" && perms.can("purchases", "approve") && <form action={approvePo}>{hidden}<input type="hidden" name="po" value={cur.id} /><button className="btn btn-green w-full">Autorizar orden</button></form>}
            {cur.status === "DRAFT" && !perms.can("purchases", "approve") && <p className="text-sm text-mute">Esta orden espera la autorización de un encargado o administrador.</p>}
            {["DRAFT", "APPROVED"].includes(cur.status) && perms.can("purchases", "edit") && !detail.items.some((i: any) => Number(i.qty_received) > 0) && <form action={cancelPo}>{hidden}<input type="hidden" name="po" value={cur.id} /><button className="btn btn-gray w-full">Cancelar orden</button></form>}
          </div>
          {["APPROVED", "PARTIAL"].includes(cur.status) && perms.can("purchases", "create") && (
            <form action={receivePo} className="f mt-5 border-t border-line pt-4">
              {hidden}<input type="hidden" name="po" value={cur.id} />
              <h3>Registrar recepción</h3><p className="text-sm text-mute">Dejá la cantidad en 0 de lo que no llegó: podés recibir la orden en partes.</p>
              {detail.items.filter((i: any) => Number(i.qty_ordered) - Number(i.qty_received) > 0).map((i: any) => (
                <div key={i.id} className="grid gap-2 rounded-lg border border-line p-3">
                  <input type="hidden" name="rc_item" value={i.id} />
                  <p className="text-sm font-medium">{i.products.name} <span className="font-normal text-mute">· pendiente {n(Number(i.qty_ordered) - Number(i.qty_received))} {i.products.unit}</span></p>
                  <div className="fgrid"><label>Cantidad recibida<input name="rc_qty" type="number" step="any" min="0" defaultValue={Number(i.qty_ordered) - Number(i.qty_received)} /></label><label>Lote<input name="rc_lot" /></label></div>
                  <label>Vencimiento (opcional)<input name="rc_exp" type="date" /></label>
                </div>
              ))}
              <label>Depósito<select name="warehouse" required>{detail.whs.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
              <label>Nota (opcional)<input name="note" placeholder="Remito N°, observaciones…" /></label>
              <button className="btn btn-green">Registrar recepción</button>
            </form>
          )}
          {detail.recs.length > 0 && (
            <div className="mt-5 border-t border-line pt-4"><h3 className="mb-2">Recepciones</h3>
              <ul className="grid gap-3 text-sm">{detail.recs.map((r: any) => {
                const inv = r.supplier_invoice_receipts?.[0]?.supplier_invoices;
                return <li key={r.id} className="rounded-lg border border-line p-3"><p className="font-medium">{day(r.receipt_date)}{r.note ? ` · ${r.note}` : ""}</p>
                  <ul className="mt-1 text-mute">{r.purchase_receipt_items.map((x: any, k: number) => <li key={k}>{n(x.qty)} {x.products.unit} de {x.products.name} · lote {x.lot_number}</li>)}</ul>
                  <p className="mt-2">{inv ? <Pill tone="green">Factura {inv.doc_type} {cbteNumber(inv.pto_vta, inv.number)}</Pill> : <Link href={`/commerce?v=invoices&dir=in&modal=invoice&supplier=${cur.supplier_id}`}>Registrar la factura de esta recepción →</Link>}</p></li>;
              })}</ul></div>
          )}
          <Link href={L({ po: null })} className="mt-4 inline-block text-sm">Cerrar detalle</Link>
        </Card>
      )}
    </>
  );
  void CBTE;
  return { title: "Órdenes de compra", intro: "Pedí a tus proveedores, autorizá, recibí en partes y seguí lo que falta.", main, aside };
}
