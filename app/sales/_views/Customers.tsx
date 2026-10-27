import Link from "next/link";
import Modal from "@/components/Modal";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, FormFooter, Empty, type PillTone } from "@/components/ui";
import { saveCustomer, deleteCustomer } from "@/app/sales-actions";
import { COND_IVA, DOC_TIPO } from "@/lib/billing";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const FILTERS: [string, string][] = [["all", "Todos"], ["ri", "Responsables Inscriptos"], ["mono", "Monotributistas"], ["cf", "Consumidores finales"], ["other", "Otros"]];
const group = (c: number) => (c === 1 ? "ri" : [6, 13, 16].includes(c) ? "mono" : c === 5 ? "cf" : "other");
const TONE: Record<string, PillTone> = { ri: "blue", mono: "green", cf: "gray", other: "amber" };

function CustomerFields({ c }: { c?: any }) {
  return (
    <div className="fgrid">
      <label className="full">Nombre o razón social<input name="name" defaultValue={c?.name} required autoFocus={!c} /></label>
      <label>Tipo de documento<select name="doc_type" defaultValue={c?.doc_type ?? 80}>{Object.entries(DOC_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Número<input name="doc_number" defaultValue={c && c.doc_type !== 99 ? c.doc_number : ""} inputMode="numeric" placeholder="Solo números" /></label>
      <label className="full">Condición frente al IVA<select name="iva_condition" defaultValue={c?.iva_condition ?? 5}>{Object.entries(COND_IVA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Email<input name="email" type="email" defaultValue={c?.email ?? ""} /></label>
      <label>Teléfono<input name="phone" defaultValue={c?.phone ?? ""} /></label>
      <label className="full">Domicilio<input name="address" defaultValue={c?.address ?? ""} /></label>
    </div>
  );
}

export default async function CustomersView({ sb, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/sales", { ...P, v: "customers" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), f = P.f ?? "all", sel = P.id ?? "", modal = P.modal ?? "";
  const canSell = ["OWNER", "ADMIN", "SALES"].includes(role);
  const { data, error } = await sb.from("customers").select("*").eq("is_active", true).order("name");
  const C = (data as any[]) ?? [];
  const rows = C.filter((c) => (!q || c.name.toLowerCase().includes(q) || c.doc_number.includes(q.replace(/\D/g, "") || "§")) && (f === "all" || group(c.iva_condition) === f));
  const cur = C.find((c) => c.id === sel);
  const back = L({ modal: null });
  const hidden = <input type="hidden" name="back" value={back} />;
  const main = (
    <div>
      {error && <p role="alert" className="mb-4 text-bad">No se pudieron leer los clientes: {error.message}. ¿Ejecutaste la migración 0007?</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/sales" keep={{ v: "customers", f: f === "all" ? undefined : f }} q={P.q} placeholder="Buscar por nombre o documento…" />
        <FilterMenu label="Condición IVA" value={f} options={FILTERS.map(([key, label]) => ({ key, label, href: L({ f: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Cliente</th><th>Documento</th><th>Condición frente al IVA</th><th>Contacto</th><th></th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} aria-selected={sel === c.id}>
              <td className="k">{c.name}</td>
              <td>{c.doc_type === 99 ? "—" : `${DOC_TIPO[c.doc_type]} ${c.doc_number}`}</td>
              <td><Pill tone={TONE[group(c.iva_condition)]}>{COND_IVA[c.iva_condition]}</Pill></td>
              <td className="text-mute">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</td>
              <td className="n"><Link href={L({ id: c.id, modal: null })}>{canSell ? "Editar" : "Ver"}</Link></td>
            </tr>
          ))}
          {!rows.length && <Empty cols={5}>{C.length ? "Ningún cliente coincide con la búsqueda o el filtro." : "Todavía no cargaste clientes. Si vendés a consumidores finales no hace falta: podés vender sin cliente."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">{rows.length} de {C.length} clientes. La condición frente al IVA define si se emite Factura A o B.</p>
      {canSell && modal === "customer" && (
        <Modal title="Nuevo cliente" closeHref={back} wide>
          <form className="f" action={saveCustomer}>{hidden}<CustomerFields /><FormFooter submit="Crear cliente" closeHref={back} /></form>
        </Modal>
      )}
    </div>
  );
  const aside = (
    <>
      {canSell && (
        <Card title="Acciones" sub="Qué podés hacer con tus clientes.">
          <div className="grid gap-2">
            <ActionLink href={L({ modal: "customer", id: null })} icon="plus">Nuevo cliente</ActionLink>
            <ActionLink href="/sales?v=sales" icon="receipt" tone="gray">Ver ventas</ActionLink>
          </div>
        </Card>
      )}
      {cur && (
        <Card title={cur.name}>
          {canSell ? (
            <>
              <form className="f" action={saveCustomer}>{hidden}<input type="hidden" name="id" value={cur.id} /><CustomerFields c={cur} /><button className="btn btn-green">Guardar cambios</button></form>
              <div className="mt-4 grid gap-2 border-t border-line pt-4 text-sm">
                <Link href={`/sales?v=sales&modal=sale&customer=${cur.id}`}>Registrar una venta a este cliente →</Link>
              </div>
              <form className="f mt-4 border-t border-line pt-4" action={deleteCustomer}>{hidden}<input type="hidden" name="id" value={cur.id} /><button className="btn btn-red">Eliminar cliente</button><p className="text-xs text-mute">Sus ventas y comprobantes anteriores se conservan.</p></form>
            </>
          ) : <p className="text-sm text-mute">{cur.address ?? "Sin domicilio cargado."}</p>}
        </Card>
      )}
    </>
  );
  return { title: "Clientes", intro: "A quién le vendés. El CUIT y la condición frente al IVA se usan al facturar.", main, aside };
}
