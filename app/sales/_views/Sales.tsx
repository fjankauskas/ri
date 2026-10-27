import Link from "next/link";
import Alert from "@/components/Alert";
import Modal from "@/components/Modal";
import SaleForm from "@/components/SaleForm";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, Empty, type PillTone } from "@/components/ui";
import { invoiceSale, creditNote } from "@/app/sales-actions";
import { CBTE, cbteNumber, computeTotals, IVA_OPTIONS, type Emisor } from "@/lib/billing";
import { money, n, day } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const FILTERS: [string, string][] = [["all", "Todas"], ["none", "Sin facturar"], ["done", "Facturadas"], ["issue", "Con error o en proceso"]];
const ivaLabel = (k: string) => IVA_OPTIONS.find((o) => o.key === k)?.label ?? k;

export default async function SalesView({ sb, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/sales", { ...P, v: "sales" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), f = P.f ?? "all", sel = P.sale ?? "", modal = P.modal ?? "";
  const canSell = ["OWNER", "ADMIN", "SALES"].includes(role);
  const [sales, prof, accs] = await Promise.all([
    sb.from("sales").select("id, sale_date, created_at, invoice_state, invoice_error, payment_method, notes, customer_id, customers(name)").order("created_at", { ascending: false }).limit(200),
    sb.from("arca_profile").select("iva_condition, enabled, active_env").maybeSingle(),
    sb.from("arca_accounts").select("environment, cert_pem, punto_venta"),
  ]);
  const S = (sales.data as any[]) ?? [], ids = S.map((x) => x.id);
  const [items, invs] = ids.length
    ? await Promise.all([sb.from("sale_items").select("sale_id, description, qty, unit_price, iva").in("sale_id", ids), sb.from("invoices").select("id, sale_id, kind, cbte_tipo, pto_vta, cbte_nro, imp_total, environment, related_invoice_id").in("sale_id", ids)])
    : [{ data: [] }, { data: [] }];
  const IT = (items.data as any[]) ?? [], INV = (invs.data as any[]) ?? [];
  const emisor = ((prof.data as any)?.iva_condition ?? "RI") as Emisor, active = (prof.data as any)?.active_env;
  const acc = ((accs.data as any[]) ?? []).find((a) => a.environment === active);
  const ready = !!(prof.data as any)?.enabled && !!acc?.cert_pem && !!acc?.punto_venta;
  const canInvoice = canSell && ready;
  const rows = S.map((s) => {
    const its = IT.filter((i) => i.sale_id === s.id), inv = INV.find((i) => i.sale_id === s.id && i.kind === "INVOICE"), nc = inv && INV.find((i) => i.related_invoice_id === inv.id);
    const total = inv ? Number(inv.imp_total) : computeTotals(its.map((i) => ({ qty: Number(i.qty), unit_price: Number(i.unit_price), iva: i.iva })), emisor).total;
    let st: { key: string; label: string; tone: PillTone };
    if (inv) st = nc ? { key: "done", label: `Anulada · NC ${cbteNumber(nc.pto_vta, nc.cbte_nro)}`, tone: "gray" } : { key: "done", label: `${CBTE[inv.cbte_tipo]} ${cbteNumber(inv.pto_vta, inv.cbte_nro)}`, tone: "green" };
    else if (s.invoice_state === "PROCESSING") st = { key: "issue", label: "En proceso", tone: "amber" };
    else if (s.invoice_error) st = { key: "issue", label: "Con error", tone: "red" };
    else st = { key: "none", label: "Sin facturar", tone: "gray" };
    return { s, its, inv, nc, total, st };
  }).filter((r) => (!q || (r.s.customers?.name ?? "consumidor final").toLowerCase().includes(q) || r.its.some((i) => i.description.toLowerCase().includes(q))) && (f === "all" || r.st.key === f));
  const picked = S.find((x) => x.id === sel);
  const cur = picked ? (() => { const its = IT.filter((i) => i.sale_id === sel), inv = INV.find((i) => i.sale_id === sel && i.kind === "INVOICE"); return { s: picked, its, inv, nc: inv ? INV.find((i) => i.related_invoice_id === inv.id) : undefined }; })() : undefined;
  const back = L({ modal: null });
  const hidden = <input type="hidden" name="back" value={back} />;

  let products: any[] = [], customers: any[] = [], warehouses: any[] = [];
  if (modal === "sale" && canSell) {
    const [p, c, w] = await Promise.all([
      sb.from("products").select("id, sku, name, unit, price, price_per, iva").eq("is_active", true).order("name"),
      sb.from("customers").select("id, name").eq("is_active", true).order("name"),
      sb.from("warehouses").select("id, name").eq("is_active", true).order("name"),
    ]);
    products = (p.data as any[]) ?? []; customers = (c.data as any[]) ?? []; warehouses = (w.data as any[]) ?? [];
  }

  const main = (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/sales" keep={{ v: "sales", f: f === "all" ? undefined : f }} q={P.q} placeholder="Buscar por cliente o producto…" />
        <FilterMenu label="Facturación" value={f} options={FILTERS.map(([key, label]) => ({ key, label, href: L({ f: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Productos</th><th className="n">Total</th><th>Facturación</th><th></th></tr></thead>
        <tbody>
          {rows.map(({ s, its, inv, total, st }) => (
            <tr key={s.id} aria-selected={sel === s.id}>
              <td>{day(s.sale_date)}</td><td className="k">{s.customers?.name ?? "Consumidor final"}</td>
              <td className="max-w-[16rem] truncate text-mute">{its.map((i) => `${n(i.qty)} × ${i.description}`).join(", ")}</td>
              <td className="n">{money(total)}</td>
              <td><div className="flex flex-wrap items-center gap-1"><Pill tone={st.tone}>{st.label}</Pill>{inv?.environment === "homologacion" && <Pill tone="blue">Prueba</Pill>}</div></td>
              <td>
                <div className="flex items-center justify-end gap-3">
                  {canInvoice && st.key === "none" && <form action={invoiceSale}>{hidden}<input type="hidden" name="sale" value={s.id} /><button className="btn btn-green btn-sm">Facturar</button></form>}
                  <Link href={L({ sale: s.id, modal: null })} className="text-sm">Detalle</Link>
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && <Empty cols={6}>{S.length ? "Ninguna venta coincide con la búsqueda o el filtro." : "Todavía no registraste ventas. Usá «Nueva venta» a la derecha."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">{rows.length} de {S.length} ventas. Cada venta descuenta el stock del depósito (primero lo que vence antes).</p>
      {modal === "sale" && canSell && (
        <Modal title="Nueva venta" closeHref={back} wide>
          {warehouses.length && products.length
            ? <SaleForm products={products} customers={customers} warehouses={warehouses} emisor={(prof.data as any)?.iva_condition ?? null} canInvoice={canInvoice} back={back} closeHref={back} defaultCustomer={P.customer} />
            : <p className="text-mute">Para vender necesitás al menos un producto y un depósito. Cargalos en <Link href="/inventory?v=products">Inventario</Link>.</p>}
        </Modal>
      )}
    </div>
  );

  const aside = (
    <>
      {canSell && (
        <Card title="Acciones" sub="Qué podés hacer con tus ventas.">
          <div className="grid gap-2">
            <ActionLink href={L({ modal: "sale" })} icon="plus">Nueva venta</ActionLink>
            <ActionLink href="/sales?v=customers&modal=customer" icon="users" tone="teal">Nuevo cliente</ActionLink>
            <ActionLink href="/sales?v=invoices" icon="receipt" tone="gray">Ver comprobantes</ActionLink>
          </div>
        </Card>
      )}
      {!ready && <Alert tone="warning" title="Facturación electrónica sin configurar" href="/sales?v=arca" action="Configurar ARCA">Podés registrar ventas, pero para emitir facturas hay que completar la configuración fiscal.</Alert>}
      {cur && (
        <Card title="Detalle de la venta" sub={`${day(cur.s.sale_date)} · ${cur.s.customers?.name ?? "Consumidor final"}${cur.s.payment_method ? ` · ${cur.s.payment_method}` : ""}`}>
          <table className="w-full text-sm"><tbody>
            {cur.its.map((i: any, k: number) => (
              <tr key={k} className="border-b border-line last:border-0"><td className="py-2 pr-2">{n(i.qty)} × {i.description}<div className="text-xs text-mute">{money(i.unit_price)} c/u · {ivaLabel(i.iva)}</div></td><td className="py-2 text-right">{money(Number(i.qty) * Number(i.unit_price))}</td></tr>
            ))}
          </tbody></table>
          <div className="mt-3 flex justify-between border-t border-line pt-3 text-base font-medium"><span>Total</span><span>{money(cur.inv ? Number(cur.inv.imp_total) : computeTotals(cur.its.map((i: any) => ({ qty: Number(i.qty), unit_price: Number(i.unit_price), iva: i.iva })), emisor).total)}</span></div>
          {cur.s.notes && <p className="mt-2 text-sm text-mute">{cur.s.notes}</p>}
          {cur.s.invoice_error && <div className="mt-4"><Alert tone={cur.s.invoice_state === "PROCESSING" ? "warning" : "danger"} title={cur.s.invoice_state === "PROCESSING" ? "Resultado incierto" : "La factura no se emitió"}>{cur.s.invoice_error}</Alert></div>}
          <div className="mt-4 grid gap-2">
            {cur.inv && <a href={`/invoice/${cur.inv.id}`} target="_blank" rel="noreferrer" className="btn btn-teal no-underline">Ver / imprimir comprobante</a>}
            {cur.nc && <a href={`/invoice/${cur.nc.id}`} target="_blank" rel="noreferrer" className="btn btn-gray no-underline">Ver nota de crédito</a>}
            {canInvoice && !cur.inv && cur.s.invoice_state !== "INVOICED" && <form action={invoiceSale}>{hidden}<input type="hidden" name="sale" value={cur.s.id} /><button className="btn btn-green w-full">{cur.s.invoice_state === "PROCESSING" ? "Reintentar facturación" : "Facturar esta venta"}</button></form>}
            {canInvoice && cur.inv && !cur.nc && (
              <form action={creditNote} className="f mt-2 border-t border-line pt-4">
                <input type="hidden" name="back" value={L({ modal: null })} /><input type="hidden" name="invoice" value={cur.inv.id} />
                <label className="flex items-center gap-2 font-normal text-mute"><input type="checkbox" name="confirm" required /> Confirmo que quiero anular esta factura</label>
                <button className="btn btn-red">Emitir nota de crédito</button>
                <p className="text-xs text-mute">Anula la factura por el total. No reingresa el stock: si devolvieron mercadería, cargala en Inventario.</p>
              </form>
            )}
            <Link href={L({ sale: null })} className="mt-1 text-sm">Cerrar detalle</Link>
          </div>
        </Card>
      )}
    </>
  );
  return { title: "Ventas", intro: "Registrá ventas, descontá el stock y emití la factura electrónica en el momento o después.", main, aside };
}
