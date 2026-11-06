import Link from "next/link";
import { Card, Pill, ActionLink, SearchBar, Empty } from "@/components/ui";
import { addPrice } from "@/app/purchases-actions";
import { myPerms } from "@/lib/perms-server";
import { money, day } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const SRC: Record<string, string> = { MANUAL: "Cotización", ORDER: "Orden de compra", RECEIPT: "Recepción" };
type PR = { supplier_id: string; product_id: string; unit_price: number; quoted_at: string; source: string; reference: string | null; suppliers?: { name: string }; products?: { name: string; unit: string; sku: string } };
/** Último precio de cada proveedor para cada producto (y el anterior, para ver la variación). */
function latest(rows: PR[]) {
  const m = new Map<string, PR[]>();
  for (const r of rows) { const k = `${r.product_id}|${r.supplier_id}`; m.set(k, [...(m.get(k) ?? []), r]); }   // vienen de más nuevo a más viejo
  return [...m.values()].map((v) => ({ cur: v[0], prev: v.find((x) => Number(x.unit_price) !== Number(v[0].unit_price)) ?? null }));
}
export default async function PricesView({ sb, org, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/commerce", { ...P, v: "prices" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), sel = P.p ?? "", perms = await myPerms(sb, org.id, role);
  const [{ data, error }, { data: sup }] = await Promise.all([
    sb.from("purchase_prices").select("supplier_id, product_id, unit_price, quoted_at, source, reference, suppliers(name), products(name, unit, sku)").order("quoted_at", { ascending: false }).order("created_at", { ascending: false }).limit(5000),
    sb.from("suppliers").select("id, name").eq("is_active", true).order("name"),
  ]);
  const ALL = (data as any[] as PR[]) ?? [], lat = latest(ALL), product = ALL.find((r) => r.product_id === sel)?.products;
  const byProduct = new Map<string, typeof lat>();
  for (const l of lat) byProduct.set(l.cur.product_id, [...(byProduct.get(l.cur.product_id) ?? []), l]);
  const overview = [...byProduct.entries()].map(([pid, ls]) => { const best = [...ls].sort((a, b) => Number(a.cur.unit_price) - Number(b.cur.unit_price))[0]; return { pid, p: ls[0].cur.products!, n: ls.length, best }; })
    .filter((r) => !q || r.p.name.toLowerCase().includes(q) || r.p.sku.toLowerCase().includes(q)).sort((a, b) => a.p.name.localeCompare(b.p.name));
  const mine = (byProduct.get(sel) ?? []).sort((a, b) => Number(a.cur.unit_price) - Number(b.cur.unit_price)), best = mine[0] ? Number(mine[0].cur.unit_price) : 0;
  const hist = ALL.filter((r) => r.product_id === sel).slice(0, 30);
  const net = sel ? ((await sb.rpc("network_prices", { p_org: org.id, p_product: sel })).data as any[] | null) ?? [] : [];
  const prods = (await sb.from("products").select("id, name, sku").eq("is_active", true).order("name")).data as any[] | null ?? [];
  const main = (
    <div className="grid gap-6">
      {error && <p role="alert" className="text-bad">No se pudo leer el historial de precios: {error.message}. ¿Ejecutaste la migración 0009?</p>}
      {!sel ? (
        <>
          <SearchBar action="/commerce" keep={{ v: "prices" }} q={P.q} placeholder="Buscar producto…" />
          <div className="tw"><table>
            <thead><tr><th>Producto</th><th className="n">Proveedores</th><th>Mejor precio actual</th><th className="n">Precio</th><th></th></tr></thead>
            <tbody>{overview.map((r) => <tr key={r.pid}><td className="k">{r.p.name}<div className="text-xs font-normal text-mute">{r.p.sku}</div></td><td className="n">{r.n}</td><td>{r.best.cur.suppliers?.name}</td><td className="n">{money(r.best.cur.unit_price)} <span className="text-xs text-mute">/{r.p.unit}</span></td><td className="n"><Link href={L({ p: r.pid })}>Comparar</Link></td></tr>)}
              {!overview.length && <Empty cols={5}>Todavía no hay precios de compra. Se cargan solos con las órdenes y recepciones, o a mano desde la derecha.</Empty>}</tbody>
          </table></div>
        </>
      ) : (
        <>
          <Card title={`Comparación: ${product?.name ?? "producto"}`} sub="Último precio neto por unidad que te dio cada proveedor.">
            <div className="tw"><table><thead><tr><th>Proveedor</th><th className="n">Precio</th><th className="n">Diferencia con el mejor</th><th className="n">Variación</th><th>Fecha</th></tr></thead><tbody>
              {mine.map((l, i) => { const p = Number(l.cur.unit_price), pv = l.prev ? Number(l.prev.unit_price) : null; return <tr key={l.cur.supplier_id}><td className="k">{l.cur.suppliers?.name} {i === 0 && <Pill tone="green">Mejor precio</Pill>}</td><td className="n">{money(p)}</td><td className="n">{i === 0 ? "—" : `+${(((p - best) / (best || 1)) * 100).toFixed(1).replace(".", ",")} %`}</td><td className={`n ${pv != null ? (p > pv ? "out" : "in") : ""}`}>{pv == null ? "—" : `${p > pv ? "▲" : "▼"} ${(Math.abs((p - pv) / (pv || 1)) * 100).toFixed(1).replace(".", ",")} %`}</td><td>{day(l.cur.quoted_at)} · {SRC[l.cur.source]}</td></tr>; })}
              {!mine.length && <Empty cols={5}>Ese producto todavía no tiene precios de compra.</Empty>}
            </tbody></table></div>
          </Card>
          {net.length > 0 && (
            <Card title="Empresas de tu red que lo publican" sub="Mismo GTIN, a su precio de lista actual.">
              <div className="tw"><table><thead><tr><th>Empresa</th><th className="n">Precio por unidad</th><th className="n">Disponible</th><th></th></tr></thead><tbody>{net.map((r: any) => <tr key={r.partner_id}><td className="k">{r.partner}</td><td className="n">{money(r.unit_price)}</td><td className="n">{r.available}</td><td className="n"><Link href="/network?v=market">Pedir</Link></td></tr>)}</tbody></table></div>
            </Card>
          )}
          <Card title="Historial" sub="Los últimos movimientos de precio de este producto."><ul className="grid gap-2 text-sm">{hist.map((h, i) => <li key={i} className="flex justify-between gap-3 border-b border-line pb-2"><span>{h.suppliers?.name}<span className="block text-xs text-mute">{day(h.quoted_at)} · {SRC[h.source]}{h.reference ? ` · ${h.reference}` : ""}</span></span><b>{money(h.unit_price)}</b></li>)}</ul></Card>
          <Link href={L({ p: null })} className="text-sm">← Volver a todos los productos</Link>
        </>
      )}
    </div>
  );
  const aside = (
    <>
      <Card title="Elegir producto"><form action="/commerce" method="get" className="f"><input type="hidden" name="v" value="prices" /><label>Producto<select name="p" defaultValue={sel}><option value="">— todos —</option>{prods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></label><button className="btn btn-green">Comparar</button></form></Card>
      {perms.can("purchases", "create") && (
        <Card title="Cargar una cotización" sub="Para sumar al historial un precio que te pasó un proveedor.">
          <form action={addPrice} className="f"><input type="hidden" name="back" value={L()} />
            <label>Proveedor<select name="supplier" required>{((sup as any[]) ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Producto<select name="product" required defaultValue={sel}>{prods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select></label>
            <div className="fgrid"><label>Precio neto por unidad<input name="price" type="number" step="any" min="0" required /></label><label>Fecha<input name="date" type="date" /></label></div>
            <label>Referencia<input name="ref" /></label><button className="btn btn-green">Guardar precio</button>
          </form>
        </Card>
      )}
      <Card title="Más"><div className="grid gap-2"><ActionLink href="/commerce?v=suppliers" icon="partners" tone="gray">Proveedores</ActionLink><ActionLink href="/commerce?v=purchases&modal=new" icon="orders" tone="gray">Nueva orden de compra</ActionLink></div></Card>
    </>
  );
  return { title: "Precios y comparador", intro: "Historial de precios de compra y comparación entre tus proveedores y la red.", main, aside };
}
