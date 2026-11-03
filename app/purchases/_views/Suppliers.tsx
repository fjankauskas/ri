import Link from "next/link";
import Modal from "@/components/Modal";
import { Card, Pill, ActionLink, SearchBar, FormFooter, Empty } from "@/components/ui";
import { saveSupplier, deleteSupplier, addPrice } from "@/app/purchases-actions";
import { myPerms } from "@/lib/perms-server";
import { money, day } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

function SupplierFields({ s, partners }: { s?: any; partners: { id: string; name: string }[] }) {
  return (
    <div className="fgrid">
      <label className="full">Nombre o razón social<input name="name" defaultValue={s?.name} required autoFocus={!s} /></label>
      <label>CUIT<input name="cuit" defaultValue={s?.cuit ?? ""} inputMode="numeric" placeholder="30-12345678-9" /></label>
      <label>Contacto<input name="contact_name" defaultValue={s?.contact_name ?? ""} /></label>
      <label>Email<input name="email" type="email" defaultValue={s?.email ?? ""} /></label>
      <label>Teléfono<input name="phone" defaultValue={s?.phone ?? ""} /></label>
      <label className="full">Domicilio<input name="address" defaultValue={s?.address ?? ""} /></label>
      <label>Plazo de pago (días)<input name="payment_days" type="number" min="0" step="1" defaultValue={s?.payment_days ?? 0} /></label>
      <label>Plazo de entrega (días)<input name="delivery_days" type="number" min="0" step="1" defaultValue={s?.delivery_days ?? ""} /></label>
      <label>Pedido mínimo ($)<input name="min_order" type="number" min="0" step="0.01" defaultValue={s?.min_order ?? ""} /></label>
      <label>Empresa de la red<select name="linked_org" defaultValue={s?.linked_org_id ?? ""}><option value="">— ninguna —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="full">Condiciones comerciales<textarea name="terms" rows={3} defaultValue={s?.terms ?? ""} placeholder="Descuentos por volumen, flete, garantía, forma de pago…" /></label>
    </div>
  );
}

export default async function SuppliersView({ sb, org, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/purchases", { ...P, v: "suppliers" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), sel = P.id ?? "", modal = P.modal ?? "", perms = await myPerms(sb, org.id, role);
  const [{ data, error }, { data: pos }, conns] = await Promise.all([
    sb.from("suppliers").select("*").eq("is_active", true).order("name"), sb.from("purchase_orders").select("supplier_id, status"), sb.rpc("my_connections"),
  ]);
  const S = (data as any[]) ?? [], partners = ((conns.data as any[]) ?? []).filter((c) => c.status === "ACTIVE").map((c) => ({ id: c.partner_id, name: c.partner }));
  const open = (id: string) => ((pos as any[]) ?? []).filter((p) => p.supplier_id === id && ["DRAFT", "APPROVED", "PARTIAL"].includes(p.status)).length;
  const rows = S.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.cuit ?? "").includes(q.replace(/\D/g, "") || "§") || (s.contact_name ?? "").toLowerCase().includes(q));
  const cur = S.find((s) => s.id === sel);
  const back = L({ modal: null });
  const hidden = <input type="hidden" name="back" value={back} />;
  let hist: any[] = [], prods: any[] = [];
  if (cur) {
    const [h, p] = await Promise.all([sb.from("purchase_prices").select("unit_price, quoted_at, source, reference, products(name, unit)").eq("supplier_id", cur.id).order("quoted_at", { ascending: false }).order("created_at", { ascending: false }).limit(12), sb.from("products").select("id, name, sku, unit").eq("is_active", true).order("name")]);
    hist = (h.data as any[]) ?? []; prods = (p.data as any[]) ?? [];
  }
  const SRC: Record<string, string> = { MANUAL: "Cargado a mano", ORDER: "Orden de compra", RECEIPT: "Recepción" };
  const main = (
    <div>
      {error && <p role="alert" className="mb-4 text-bad">No se pudieron leer los proveedores: {error.message}. ¿Ejecutaste la migración 0009?</p>}
      <div className="mb-4"><SearchBar action="/purchases" keep={{ v: "suppliers" }} q={P.q} placeholder="Buscar por nombre, CUIT o contacto…" /></div>
      <div className="tw"><table>
        <thead><tr><th>Proveedor</th><th>CUIT</th><th>Contacto</th><th>Pago</th><th>Entrega</th><th className="n">Pedido mín.</th><th></th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} aria-selected={sel === s.id}>
              <td className="k">{s.name}<div className="flex gap-1 pt-1">{s.linked_org_id && <Pill tone="blue">Red</Pill>}{open(s.id) > 0 && <Pill tone="amber">{open(s.id)} OC abierta(s)</Pill>}</div></td>
              <td className="font-mono text-sm">{s.cuit ?? "—"}</td><td>{s.contact_name ?? <span className="text-mute">—</span>}<div className="text-xs text-mute">{[s.email, s.phone].filter(Boolean).join(" · ")}</div></td>
              <td>{s.payment_days ? `${s.payment_days} días` : "Contado"}</td><td>{s.delivery_days != null ? `${s.delivery_days} días` : "—"}</td><td className="n">{s.min_order != null ? money(s.min_order) : "—"}</td>
              <td className="n"><Link href={L({ id: s.id, modal: null })}>{perms.can("purchases", "edit") ? "Editar" : "Ver"}</Link></td>
            </tr>
          ))}
          {!rows.length && <Empty cols={7}>{S.length ? "Ningún proveedor coincide con la búsqueda." : "Todavía no cargaste proveedores. Usá «Nuevo proveedor» a la derecha."}</Empty>}
        </tbody>
      </table></div>
      {perms.can("purchases", "create") && modal === "supplier" && <Modal title="Nuevo proveedor" closeHref={back} wide><form className="f" action={saveSupplier}>{hidden}<SupplierFields partners={partners} /><FormFooter submit="Crear proveedor" closeHref={back} /></form></Modal>}
    </div>
  );
  const aside = (
    <>
      <Card title="Acciones" sub="Con quién comprás y a qué condiciones.">
        <div className="grid gap-2">
          {perms.can("purchases", "create") && <ActionLink href={L({ modal: "supplier", id: null })} icon="plus">Nuevo proveedor</ActionLink>}
          <ActionLink href="/purchases?v=orders" icon="orders" tone="gray">Órdenes de compra</ActionLink>
          <ActionLink href="/network?v=market" icon="market" tone="gray">Comprar a la red</ActionLink>
        </div>
      </Card>
      {cur && (
        <Card title={cur.name}>
          {perms.can("purchases", "edit") ? <form className="f" action={saveSupplier}>{hidden}<input type="hidden" name="id" value={cur.id} /><SupplierFields s={cur} partners={partners} /><button className="btn btn-green">Guardar cambios</button></form>
            : <p className="whitespace-pre-line text-sm text-mute">{cur.terms ?? "Sin condiciones comerciales cargadas."}</p>}
          <div className="mt-4 grid gap-2 border-t border-line pt-4">
            {perms.can("purchases", "create") && <Link href={`/purchases?v=orders&modal=new&supplier=${cur.id}`} className="btn btn-teal no-underline">Nueva orden de compra</Link>}
            {cur.linked_org_id && <Link href="/network?v=market" className="btn btn-gray no-underline">Ver su stock publicado en la red</Link>}
          </div>
          <h3 className="mt-5 border-t border-line pt-4">Historial de precios</h3>
          <ul className="mt-2 grid gap-2 text-sm">{hist.map((h, i) => <li key={i} className="flex justify-between gap-3"><span>{h.products.name}<span className="block text-xs text-mute">{day(h.quoted_at)} · {SRC[h.source]}{h.reference ? ` · ${h.reference}` : ""}</span></span><span className="font-medium">{money(h.unit_price)}<span className="text-xs font-normal text-mute"> /{h.products.unit}</span></span></li>)}{!hist.length && <li className="text-mute">Sin precios todavía: se llenan solos con las órdenes y recepciones.</li>}</ul>
          {perms.can("purchases", "create") && (
            <form action={addPrice} className="f mt-4 rounded-lg border border-line p-3">
              {hidden}<input type="hidden" name="supplier" value={cur.id} /><h3>Cargar una cotización</h3>
              <label>Producto<select name="product" required>{prods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></label>
              <div className="fgrid"><label>Precio neto por unidad<input name="price" type="number" step="any" min="0" required /></label><label>Fecha<input name="date" type="date" /></label></div>
              <label>Referencia (opcional)<input name="ref" placeholder="Lista de precios, presupuesto…" /></label>
              <button className="btn btn-gray justify-self-start">Guardar precio</button>
            </form>
          )}
          {perms.can("purchases", "delete") && <form className="f mt-4 border-t border-line pt-4" action={deleteSupplier}>{hidden}<input type="hidden" name="id" value={cur.id} /><button className="btn btn-red">Eliminar proveedor</button><p className="text-xs text-mute">Se conserva su historial. No se puede eliminar con órdenes abiertas.</p></form>}
        </Card>
      )}
    </>
  );
  return { title: "Proveedores", intro: "CUIT, contacto y condiciones comerciales de cada proveedor, con su historial de precios.", main, aside };
}
