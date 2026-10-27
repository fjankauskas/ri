import Link from "next/link";
import Alert from "@/components/Alert";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, Empty } from "@/components/ui";
import { creditNote } from "@/app/sales-actions";
import { CBTE, cbteNumber } from "@/lib/billing";
import { money, day } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const KIND: [string, string][] = [["all", "Todos"], ["invoice", "Facturas"], ["credit", "Notas de crédito"]];
const ENV: [string, string][] = [["all", "Todos"], ["produccion", "Producción"], ["homologacion", "Prueba (homologación)"]];

export default async function InvoicesView({ sb, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/sales", { ...P, v: "invoices" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), k = P.k ?? "all", e = P.env ?? "all", sel = P.inv ?? "";
  const canSell = ["OWNER", "ADMIN", "SALES"].includes(role);
  const { data, error } = await sb.from("invoices").select("id, sale_id, kind, related_invoice_id, environment, cbte_tipo, pto_vta, cbte_nro, cbte_fch, receptor_nombre, imp_total, cae, cae_vto, observaciones, created_at").order("created_at", { ascending: false }).limit(300);
  const I = (data as any[]) ?? [], credited = new Set(I.filter((i) => i.kind === "CREDIT_NOTE").map((i) => i.related_invoice_id));
  const rows = I.filter((i) => (!q || i.receptor_nombre.toLowerCase().includes(q) || cbteNumber(i.pto_vta, i.cbte_nro).includes(q) || i.cae.includes(q))
    && (k === "all" || (k === "invoice" ? i.kind === "INVOICE" : i.kind === "CREDIT_NOTE")) && (e === "all" || i.environment === e));
  const cur = I.find((i) => i.id === sel);
  const main = (
    <div>
      {error && <p role="alert" className="mb-4 text-bad">No se pudieron leer los comprobantes: {error.message}. ¿Ejecutaste la migración 0007?</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/sales" keep={{ v: "invoices", k: k === "all" ? undefined : k, env: e === "all" ? undefined : e }} q={P.q} placeholder="Buscar por cliente, número o CAE…" />
        <FilterMenu label="Tipo" value={k} options={KIND.map(([key, label]) => ({ key, label, href: L({ k: key === "all" ? null : key }) }))} />
        <FilterMenu label="Ambiente" value={e} options={ENV.map(([key, label]) => ({ key, label, href: L({ env: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Fecha</th><th>Comprobante</th><th>Cliente</th><th className="n">Total</th><th>CAE</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} aria-selected={sel === i.id}>
              <td>{day(i.cbte_fch)}</td>
              <td className="k">{CBTE[i.cbte_tipo]} <span className="font-normal text-mute">{cbteNumber(i.pto_vta, i.cbte_nro)}</span></td>
              <td>{i.receptor_nombre}</td>
              <td className="n">{money(i.imp_total)}</td>
              <td className="font-mono text-xs text-mute">{i.cae}<div>vence {day(i.cae_vto)}</div></td>
              <td><div className="flex flex-wrap gap-1">{i.environment === "homologacion" ? <Pill tone="blue">Prueba</Pill> : <Pill tone="green">Producción</Pill>}{credited.has(i.id) && <Pill tone="gray">Anulada</Pill>}</div></td>
              <td className="n"><div className="flex items-center justify-end gap-3"><a href={`/invoice/${i.id}`} target="_blank" rel="noreferrer" className="text-sm">Imprimir</a><Link href={L({ inv: i.id })} className="text-sm">Detalle</Link></div></td>
            </tr>
          ))}
          {!rows.length && <Empty cols={7}>{I.length ? "Ningún comprobante coincide con la búsqueda o el filtro." : "Todavía no se emitieron comprobantes. Se generan al facturar una venta."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">{rows.length} de {I.length} comprobantes. Los de «Prueba» se emitieron en homologación y no tienen validez fiscal.</p>
    </div>
  );
  const aside = (
    <>
      <Card title="Acciones" sub="Qué podés hacer con tus comprobantes.">
        <div className="grid gap-2">
          <ActionLink href="/sales?v=sales" icon="receipt">Ver ventas</ActionLink>
          <ActionLink href="/sales?v=arca" icon="shield" tone="gray">Configuración de ARCA</ActionLink>
        </div>
      </Card>
      {cur && (
        <Card title={`${CBTE[cur.cbte_tipo]} ${cbteNumber(cur.pto_vta, cur.cbte_nro)}`} sub={`${cur.receptor_nombre} · ${money(cur.imp_total)}`}>
          <dl className="grid gap-2 text-sm">
            {([["Fecha", day(cur.cbte_fch)], ["CAE", cur.cae], ["Vencimiento del CAE", day(cur.cae_vto)], ["Ambiente", cur.environment === "homologacion" ? "Prueba (homologación)" : "Producción"]] as [string, string][]).map(([a, b]) => <div key={a} className="flex justify-between gap-3"><dt className="text-mute">{a}</dt><dd className="break-all text-right">{b}</dd></div>)}
          </dl>
          {(cur.observaciones ?? []).length > 0 && <div className="mt-4"><Alert tone="warning" title="ARCA informó observaciones">{(cur.observaciones as any[]).map((o) => `(${o.code}) ${o.msg}`).join(" · ")}</Alert></div>}
          <div className="mt-4 grid gap-2">
            <a href={`/invoice/${cur.id}`} target="_blank" rel="noreferrer" className="btn btn-teal no-underline">Imprimir comprobante</a>
            <Link href={`/sales?v=sales&sale=${cur.sale_id}`} className="btn btn-gray no-underline">Ver la venta</Link>
            {canSell && cur.kind === "INVOICE" && !credited.has(cur.id) && (
              <form action={creditNote} className="f mt-2 border-t border-line pt-4">
                <input type="hidden" name="back" value={L({ inv: null })} /><input type="hidden" name="invoice" value={cur.id} />
                <label className="flex items-center gap-2 font-normal text-mute"><input type="checkbox" name="confirm" required /> Confirmo que quiero anular esta factura</label>
                <button className="btn btn-red">Emitir nota de crédito</button>
                <p className="text-xs text-mute">Anula la factura por el total. No reingresa el stock.</p>
              </form>
            )}
            {credited.has(cur.id) && <p className="text-sm text-mute">Esta factura ya tiene una nota de crédito.</p>}
            <Link href={L({ inv: null })} className="mt-1 text-sm">Cerrar detalle</Link>
          </div>
        </Card>
      )}
    </>
  );
  return { title: "Comprobantes", intro: "Facturas y notas de crédito autorizadas por ARCA, con su CAE.", main, aside };
}
