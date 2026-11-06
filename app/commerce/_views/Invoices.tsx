import Link from "next/link";
import Alert from "@/components/Alert";
import Modal from "@/components/Modal";
import SupplierInvoiceForm from "@/components/SupplierInvoiceForm";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, Empty, type PillTone } from "@/components/ui";
import { creditNote } from "@/app/sales-actions";
import { payInvoice } from "@/app/purchases-actions";
import { myPerms } from "@/lib/perms-server";
import { CBTE, cbteNumber } from "@/lib/billing";
import { money, n, day } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const DIR: [string, string][] = [["all", "Emitidas y recibidas"], ["out", "Emitidas (a clientes)"], ["in", "Recibidas (de proveedores)"]];
const STATE: [string, string][] = [["all", "Todos"], ["pending", "Recibidas por pagar"], ["paid", "Recibidas pagadas"], ["voided", "Emitidas anuladas"], ["test", "Emitidas de prueba"]];
const poNum = (x: number) => `OC-${String(x).padStart(4, "0")}`;
type Row = { key: string; dir: "out" | "in"; date: string; at: string; label: string; party: string; total: number; pills: [string, PillTone][]; tags: string[]; search: string };

export default async function InvoicesView({ sb, org, role, P }: ViewCtx): Promise<View> {
  const dir = ["in", "out"].includes(P.dir ?? "") ? (P.dir as "in" | "out") : "all", f = STATE.some(([k]) => k === P.f) ? (P.f as string) : "all", q = (P.q ?? "").trim().toLowerCase(), sel = P.i ?? "", modal = P.modal ?? "";
  const L = (patch: Record<string, string | null> = {}) => mk("/commerce", { ...P, v: "invoices" }, patch);
  const perms = await myPerms(sb, org.id, role);
  const [outR, inR, linkR, itemR] = await Promise.all([
    sb.from("invoices").select("id, sale_id, kind, related_invoice_id, environment, cbte_tipo, pto_vta, cbte_nro, cbte_fch, receptor_nombre, imp_total, cae, cae_vto, observaciones, created_at").order("created_at", { ascending: false }).limit(300),
    sb.from("supplier_invoices").select("id, supplier_id, doc_type, pto_vta, number, invoice_date, due_date, total_net, total_iva, total, cae, status, paid_at, notes, created_at, suppliers(name)").order("invoice_date", { ascending: false }).limit(300),
    sb.from("supplier_invoice_receipts").select("invoice_id, receipt_id"), sb.from("purchase_receipt_items").select("receipt_id, qty, unit_price"),
  ]);
  const O = (outR.data as any[]) ?? [], I = (inR.data as any[]) ?? [], LK = (linkR.data as any[]) ?? [], RI = (itemR.data as any[]) ?? [];
  const credited = new Set(O.filter((i) => i.kind === "CREDIT_NOTE").map((i) => i.related_invoice_id));
  const expected = (id: string) => { const rs = new Set(LK.filter((l) => l.invoice_id === id).map((l) => l.receipt_id)); return Math.round(RI.filter((x) => rs.has(x.receipt_id)).reduce((a, x) => a + Number(x.qty) * Number(x.unit_price), 0) * 100) / 100; };
  const sign = (t: string) => (t === "NC" ? -1 : 1);

  const all: Row[] = [
    ...O.map((i): Row => ({ key: `out:${i.id}`, dir: "out", date: i.cbte_fch, at: i.created_at, label: `${CBTE[i.cbte_tipo]} ${cbteNumber(i.pto_vta, i.cbte_nro)}`, party: i.receptor_nombre, total: (i.kind === "CREDIT_NOTE" ? -1 : 1) * Number(i.imp_total),
      pills: [i.environment === "homologacion" ? ["Prueba", "blue"] : ["Producción", "green"], ...(credited.has(i.id) ? [["Anulada", "gray"] as [string, PillTone]] : [])], tags: [...(i.environment === "homologacion" ? ["test"] : []), ...(credited.has(i.id) ? ["voided"] : [])], search: `${i.receptor_nombre} ${cbteNumber(i.pto_vta, i.cbte_nro)} ${i.cae}`.toLowerCase() })),
    ...I.map((i): Row => { const linked = LK.some((l) => l.invoice_id === i.id); return { key: `in:${i.id}`, dir: "in", date: i.invoice_date, at: i.created_at, label: `Factura ${i.doc_type} ${cbteNumber(i.pto_vta, i.number)}`, party: i.suppliers?.name ?? "—", total: sign(i.doc_type) * Number(i.total),
      pills: [i.status === "PAID" ? ["Pagada", "green"] : ["Por pagar", "amber"], ...(linked ? [] : [["Sin vincular", "gray"] as [string, PillTone]])], tags: [i.status === "PAID" ? "paid" : "pending"], search: `${i.suppliers?.name ?? ""} ${cbteNumber(i.pto_vta, i.number)}`.toLowerCase() }; }),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.at.localeCompare(a.at));
  const rows = all.filter((r) => (dir === "all" || r.dir === dir) && (!q || r.search.includes(q)) && (f === "all" || r.tags.includes(f)));

  const billed = O.filter((i) => i.kind === "INVOICE" && i.environment === "produccion" && !credited.has(i.id)).reduce((a, i) => a + Number(i.imp_total), 0);
  const received = I.reduce((a, i) => a + sign(i.doc_type) * Number(i.total), 0), toPay = I.filter((i) => i.status === "PENDING").reduce((a, i) => a + sign(i.doc_type) * Number(i.total), 0), unlinked = I.filter((i) => !LK.some((l) => l.invoice_id === i.id)).length;

  const [selDir, selId] = sel.split(":"), curOut = selDir === "out" ? O.find((i) => i.id === selId) : null, curIn = selDir === "in" ? I.find((i) => i.id === selId) : null;
  const back = L({ modal: null }), hidden = <input type="hidden" name="back" value={back} />;
  let linked: any[] = [], pending: { id: string; label: string; expected: number }[] = [], suppliers: any[] = [];
  if (curIn) { const ids = LK.filter((l) => l.invoice_id === curIn.id).map((l) => l.receipt_id); if (ids.length) { const { data: r } = await sb.from("purchase_receipts").select("id, receipt_date, purchase_orders(number), purchase_receipt_items(qty, unit_price, lot_number, products(name, unit))").in("id", ids); linked = (r as any[]) ?? []; } }
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
      {outR.error && <p role="alert" className="mb-2 text-bad">No se pudieron leer las facturas emitidas: {outR.error.message}. ¿Ejecutaste la migración 0007?</p>}
      {inR.error && <p role="alert" className="mb-2 text-bad">No se pudieron leer las facturas recibidas: {inR.error.message}. ¿Ejecutaste la migración 0009?</p>}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {([["Facturado (producción)", money(billed), "Emitidas vigentes, sin pruebas ni anuladas"], ["Facturas recibidas", money(received), "Total de proveedores"], ["Por pagar", money(toPay), "Recibidas pendientes de pago"], ["Sin vincular", String(unlinked), "Recibidas sin recepción asociada"]] as [string, string, string][]).map(([l, v, h]) => (
          <div key={l} className="rounded-xl border border-line bg-card p-5"><p className="text-sm text-mute">{l}</p><p className="mt-2 text-2xl font-light">{v}</p><p className="mt-1 text-xs text-mute">{h}</p></div>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/commerce" keep={{ v: "invoices", dir: dir === "all" ? undefined : dir, f: f === "all" ? undefined : f }} q={P.q} placeholder="Buscar por cliente, proveedor, número o CAE…" />
        <FilterMenu label="Sentido" value={dir} options={DIR.map(([key, label]) => ({ key, label, href: L({ dir: key === "all" ? null : key }) }))} />
        <FilterMenu label="Estado" value={f} options={STATE.map(([key, label]) => ({ key, label, href: L({ f: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Sentido</th><th>Fecha</th><th>Comprobante</th><th>Cliente / Proveedor</th><th className="n">Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} aria-selected={sel === r.key}>
              <td><Pill tone={r.dir === "out" ? "blue" : "amber"}>{r.dir === "out" ? "Emitida" : "Recibida"}</Pill></td><td>{day(r.date)}</td><td className="k">{r.label}</td><td>{r.party}</td>
              <td className={`n ${r.total < 0 ? "out" : ""}`}>{money(r.total)}</td><td><div className="flex flex-wrap gap-1">{r.pills.map(([t, tone]) => <Pill key={t} tone={tone}>{t}</Pill>)}</div></td>
              <td className="n"><div className="flex items-center justify-end gap-3">{r.dir === "out" && <a href={`/invoice/${r.key.slice(4)}`} target="_blank" rel="noreferrer" className="text-sm">Imprimir</a>}<Link href={L({ i: r.key, modal: null })} className="text-sm">Detalle</Link></div></td>
            </tr>
          ))}
          {!rows.length && <Empty cols={7}>{all.length ? "Ninguna factura coincide con la búsqueda o el filtro." : "Todavía no hay facturas. Las emitidas se generan al facturar una venta; las recibidas se registran desde la derecha."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">{rows.length} de {all.length} comprobantes. Las de «Prueba» se emitieron en homologación y no tienen validez fiscal.</p>
      {modal === "invoice" && perms.can("purchases", "create") && (
        <Modal title="Registrar factura recibida" closeHref={back} wide>
          <form action="/commerce" method="get" className="mb-5 flex flex-wrap items-end gap-3"><input type="hidden" name="v" value="invoices" /><input type="hidden" name="modal" value="invoice" />
            <label className="min-w-[14rem] flex-1">Proveedor<select name="supplier" defaultValue={P.supplier ?? ""}><option value="">— elegir —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="btn btn-gray">Ver sus recepciones</button></form>
          {P.supplier ? <SupplierInvoiceForm key={P.supplier} supplier={P.supplier} receipts={pending} back={back} closeHref={back} /> : <p className="text-sm text-mute">Elegí el proveedor para ver las recepciones que todavía no tienen factura.</p>}
        </Modal>
      )}
    </div>
  );
  const aside = (
    <>
      <Card title="Acciones" sub="Todas tus facturas en un solo lugar.">
        <div className="grid gap-2">
          {perms.can("sales", "create") && <ActionLink href="/commerce?v=sales&modal=sale" icon="plus">Nueva venta</ActionLink>}
          {perms.can("purchases", "create") && <ActionLink href={L({ modal: "invoice", i: null })} icon="receipt" tone="teal">Registrar factura recibida</ActionLink>}
          <ActionLink href="/commerce?v=arca" icon="shield" tone="gray">Configuración de ARCA</ActionLink>
        </div>
      </Card>
      {curOut && (
        <Card title={`${CBTE[curOut.cbte_tipo]} ${cbteNumber(curOut.pto_vta, curOut.cbte_nro)}`} sub={`Emitida a ${curOut.receptor_nombre} · ${money(curOut.imp_total)}`}>
          <dl className="grid gap-2 text-sm">{([["Fecha", day(curOut.cbte_fch)], ["CAE", curOut.cae], ["Vencimiento del CAE", day(curOut.cae_vto)], ["Ambiente", curOut.environment === "homologacion" ? "Prueba (homologación)" : "Producción"]] as [string, string][]).map(([a, b]) => <div key={a} className="flex justify-between gap-3"><dt className="text-mute">{a}</dt><dd className="break-all text-right">{b}</dd></div>)}</dl>
          {(curOut.observaciones ?? []).length > 0 && <div className="mt-4"><Alert tone="warning" title="ARCA informó observaciones">{(curOut.observaciones as any[]).map((o) => `(${o.code}) ${o.msg}`).join(" · ")}</Alert></div>}
          <div className="mt-4 grid gap-2">
            <a href={`/invoice/${curOut.id}`} target="_blank" rel="noreferrer" className="btn btn-teal no-underline">Imprimir comprobante</a>
            <Link href={`/commerce?v=sales&sale=${curOut.sale_id}`} className="btn btn-gray no-underline">Ver la venta</Link>
            {perms.can("invoicing", "approve") && curOut.kind === "INVOICE" && !credited.has(curOut.id) && (
              <form action={creditNote} className="f mt-2 border-t border-line pt-4">
                <input type="hidden" name="back" value={L({ i: null })} /><input type="hidden" name="invoice" value={curOut.id} />
                <label className="flex items-center gap-2 font-normal text-mute"><input type="checkbox" name="confirm" required /> Confirmo que quiero anular esta factura</label>
                <button className="btn btn-red">Emitir nota de crédito</button><p className="text-xs text-mute">Anula la factura por el total. No reingresa el stock.</p>
              </form>
            )}
            {credited.has(curOut.id) && <p className="text-sm text-mute">Esta factura ya tiene una nota de crédito.</p>}
            <Link href={L({ i: null })} className="mt-1 text-sm">Cerrar detalle</Link>
          </div>
        </Card>
      )}
      {curIn && (
        <Card title={`Factura ${curIn.doc_type} ${cbteNumber(curIn.pto_vta, curIn.number)}`} sub={`Recibida de ${curIn.suppliers?.name} · ${day(curIn.invoice_date)}`}>
          <dl className="grid gap-2 text-sm">{([["Neto", money(curIn.total_net)], ["IVA", money(curIn.total_iva)], ["Total", money(curIn.total)], ["Neto según recepciones", linked.length ? money(expected(curIn.id)) : "—"], ["Vencimiento", day(curIn.due_date)], ...(curIn.cae ? [["CAE", curIn.cae]] : [])] as [string, string][]).map(([a, b]) => <div key={a} className="flex justify-between gap-3"><dt className="text-mute">{a}</dt><dd className="text-right">{b}</dd></div>)}</dl>
          {linked.length > 0 && Math.abs(Number(curIn.total_net) - expected(curIn.id)) >= 0.05 && <p className="mt-3 text-sm out">El neto facturado difiere en {money(Number(curIn.total_net) - expected(curIn.id))} de lo recibido: revisá precios o cantidades.</p>}
          <h3 className="mt-4 border-t border-line pt-4">Productos recibidos con esta factura</h3>
          {linked.length ? <ul className="mt-2 grid gap-3 text-sm">{linked.map((r) => <li key={r.id} className="rounded-lg border border-line p-3"><p className="font-medium">{day(r.receipt_date)} · {poNum(r.purchase_orders.number)}</p><ul className="text-mute">{r.purchase_receipt_items.map((x: any, k: number) => <li key={k}>{n(x.qty)} {x.products.unit} de {x.products.name} · lote {x.lot_number} · {money(x.unit_price)} c/u</li>)}</ul></li>)}</ul> : <p className="mt-2 text-sm text-mute">Esta factura no está vinculada a ninguna recepción.</p>}
          {perms.can("purchases", "approve") && <form action={payInvoice} className="mt-4">{hidden}<input type="hidden" name="id" value={curIn.id} /><input type="hidden" name="paid" value={curIn.status === "PAID" ? "0" : "1"} /><button className={`btn w-full ${curIn.status === "PAID" ? "btn-gray" : "btn-green"}`}>{curIn.status === "PAID" ? "Marcar como pendiente" : "Marcar como pagada"}</button></form>}
          <Link href={L({ i: null })} className="mt-3 inline-block text-sm">Cerrar detalle</Link>
        </Card>
      )}
    </>
  );
  return { title: "Facturas", intro: "Las que emitís a tus clientes y las que recibís de tus proveedores, en un solo lugar.", main, aside };
}
