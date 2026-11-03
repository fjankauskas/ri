import Link from "next/link";
import Modal from "@/components/Modal";
import SupplierInvoiceForm from "@/components/SupplierInvoiceForm";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, Empty } from "@/components/ui";
import { payInvoice } from "@/app/purchases-actions";
import { myPerms } from "@/lib/perms-server";
import { cbteNumber } from "@/lib/billing";
import { money, n, day } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const FILTERS: [string, string][] = [["all", "Todas"], ["PENDING", "Pendientes de pago"], ["PAID", "Pagadas"]];
const poNum = (x: number) => `OC-${String(x).padStart(4, "0")}`;
export default async function InvoicesView({ sb, org, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/purchases", { ...P, v: "invoices" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), f = P.f ?? "all", sel = P.inv ?? "", modal = P.modal ?? "", perms = await myPerms(sb, org.id, role);
  const [{ data, error }, { data: links }, { data: ritems }] = await Promise.all([
    sb.from("supplier_invoices").select("id, supplier_id, doc_type, pto_vta, number, invoice_date, due_date, total_net, total_iva, total, cae, status, paid_at, notes, suppliers(name)").order("invoice_date", { ascending: false }).limit(200),
    sb.from("supplier_invoice_receipts").select("invoice_id, receipt_id"), sb.from("purchase_receipt_items").select("receipt_id, qty, unit_price"),
  ]);
  const I = (data as any[]) ?? [], LK = (links as any[]) ?? [], RI = (ritems as any[]) ?? [];
  const expected = (id: string) => { const rs = new Set(LK.filter((l) => l.invoice_id === id).map((l) => l.receipt_id)); return Math.round(RI.filter((x) => rs.has(x.receipt_id)).reduce((a, x) => a + Number(x.qty) * Number(x.unit_price), 0) * 100) / 100; };
  const rows = I.filter((i) => (!q || i.suppliers?.name.toLowerCase().includes(q) || String(i.number).includes(q)) && (f === "all" || i.status === f));
  const cur = I.find((i) => i.id === sel);
  const back = L({ modal: null }), hidden = <input type="hidden" name="back" value={back} />;
  let linked: any[] = [], pending: { id: string; label: string; expected: number }[] = [], suppliers: any[] = [];
  if (cur) { const ids = LK.filter((l) => l.invoice_id === cur.id).map((l) => l.receipt_id); if (ids.length) { const { data: r } = await sb.from("purchase_receipts").select("id, receipt_date, purchase_orders(number), purchase_receipt_items(qty, unit_price, lot_number, products(name, unit))").in("id", ids); linked = (r as any[]) ?? []; } }
  if (modal === "invoice" && perms.can("purchases", "create")) {
    const { data: sup } = await sb.from("suppliers").select("id, name").eq("is_active", true).order("name"); suppliers = (sup as any[]) ?? [];
    if (P.supplier) {
      const { data: rc } = await sb.from("purchase_receipts").select("id, receipt_date, purchase_orders(number), purchase_receipt_items(qty, unit_price, products(name, unit))").eq("supplier_id", P.supplier).order("receipt_date", { ascending: false }).limit(200);
      const taken = new Set(LK.map((l) => l.receipt_id));
      pending = ((rc as any[]) ?? []).filter((r) => !taken.has(r.id)).map((r) => ({ id: r.id, label: `${day(r.receipt_date)} · ${poNum(r.purchase_orders.number)} · ${r.purchase_receipt_items.map((x: any) => `${n(x.qty)} ${x.products.unit} ${x.products.name}`).join(", ")}`, expected: Math.round(r.purchase_receipt_items.reduce((a: number, x: any) => a + Number(x.qty) * Number(x.unit_price), 0) * 100) / 100 }));
    }
  }
  const main = (
    <div>
      {error && <p role="alert" className="mb-4 text-bad">No se pudieron leer las facturas: {error.message}. ¿Ejecutaste la migración 0009?</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/purchases" keep={{ v: "invoices", f: f === "all" ? undefined : f }} q={P.q} placeholder="Buscar por proveedor o número…" />
        <FilterMenu label="Estado" value={f} options={FILTERS.map(([key, label]) => ({ key, label, href: L({ f: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Fecha</th><th>Proveedor</th><th>Factura</th><th className="n">Neto</th><th className="n">Total</th><th>Recepciones</th><th>Vence</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.map((i) => { const nl = LK.filter((l) => l.invoice_id === i.id).length, ex = expected(i.id), diff = Math.round((Number(i.total_net) - ex) * 100) / 100; return (
            <tr key={i.id} aria-selected={sel === i.id}>
              <td>{day(i.invoice_date)}</td><td className="k">{i.suppliers?.name}</td><td className="font-mono text-sm">{i.doc_type} {cbteNumber(i.pto_vta, i.number)}</td>
              <td className="n">{money(i.total_net)}</td><td className="n">{money(i.total)}</td>
              <td>{nl ? <span className="text-sm">{nl} · {Math.abs(diff) < 0.05 ? <span className="in">coincide</span> : <span className="out">difiere {money(diff)}</span>}</span> : <Pill tone="amber">Sin vincular</Pill>}</td>
              <td>{day(i.due_date)}</td><td><Pill tone={i.status === "PAID" ? "green" : "amber"}>{i.status === "PAID" ? "Pagada" : "Pendiente"}</Pill></td>
              <td className="n"><Link href={L({ inv: i.id, modal: null })}>Detalle</Link></td>
            </tr>); })}
          {!rows.length && <Empty cols={9}>{I.length ? "Ninguna factura coincide con la búsqueda o el filtro." : "Todavía no cargaste facturas de proveedores."}</Empty>}
        </tbody>
      </table></div>
      {modal === "invoice" && perms.can("purchases", "create") && (
        <Modal title="Registrar factura de proveedor" closeHref={back} wide>
          <form action="/purchases" method="get" className="mb-5 flex flex-wrap items-end gap-3"><input type="hidden" name="v" value="invoices" /><input type="hidden" name="modal" value="invoice" />
            <label className="min-w-[14rem] flex-1">Proveedor<select name="supplier" defaultValue={P.supplier ?? ""}><option value="">— elegir —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="btn btn-gray">Ver sus recepciones</button></form>
          {P.supplier ? <SupplierInvoiceForm key={P.supplier} supplier={P.supplier} receipts={pending} back={back} closeHref={back} /> : <p className="text-sm text-mute">Elegí el proveedor para ver las recepciones que todavía no tienen factura.</p>}
        </Modal>
      )}
    </div>
  );
  const aside = (
    <>
      <Card title="Acciones" sub="Vinculá cada factura con lo que realmente recibiste.">
        <div className="grid gap-2">{perms.can("purchases", "create") && <ActionLink href={L({ modal: "invoice", inv: null })} icon="plus">Registrar factura</ActionLink>}<ActionLink href="/purchases?v=orders" icon="orders" tone="gray">Órdenes de compra</ActionLink></div>
      </Card>
      {cur && (
        <Card title={`${cur.doc_type} ${cbteNumber(cur.pto_vta, cur.number)}`} sub={`${cur.suppliers?.name} · ${day(cur.invoice_date)}`}>
          <dl className="grid gap-2 text-sm">{([["Neto", money(cur.total_net)], ["IVA", money(cur.total_iva)], ["Total", money(cur.total)], ["Neto según recepciones", linked.length ? money(expected(cur.id)) : "—"], ["Vencimiento", day(cur.due_date)], ...(cur.cae ? [["CAE", cur.cae]] : [])] as [string, string][]).map(([a, b]) => <div key={a} className="flex justify-between gap-3"><dt className="text-mute">{a}</dt><dd className="text-right">{b}</dd></div>)}</dl>
          <h3 className="mt-4 border-t border-line pt-4">Productos recibidos con esta factura</h3>
          {linked.length ? <ul className="mt-2 grid gap-3 text-sm">{linked.map((r) => <li key={r.id} className="rounded-lg border border-line p-3"><p className="font-medium">{day(r.receipt_date)} · {poNum(r.purchase_orders.number)}</p><ul className="text-mute">{r.purchase_receipt_items.map((x: any, k: number) => <li key={k}>{n(x.qty)} {x.products.unit} de {x.products.name} · lote {x.lot_number} · {money(x.unit_price)} c/u</li>)}</ul></li>)}</ul> : <p className="mt-2 text-sm text-mute">Esta factura no está vinculada a ninguna recepción.</p>}
          {perms.can("purchases", "approve") && <form action={payInvoice} className="mt-4">{hidden}<input type="hidden" name="id" value={cur.id} /><input type="hidden" name="paid" value={cur.status === "PAID" ? "0" : "1"} /><button className={`btn w-full ${cur.status === "PAID" ? "btn-gray" : "btn-green"}`}>{cur.status === "PAID" ? "Marcar como pendiente" : "Marcar como pagada"}</button></form>}
          <Link href={L({ inv: null })} className="mt-3 inline-block text-sm">Cerrar detalle</Link>
        </Card>
      )}
    </>
  );
  return { title: "Facturas de proveedores", intro: "Cada factura queda vinculada a su proveedor y a los productos que efectivamente entraron.", main, aside };
}
