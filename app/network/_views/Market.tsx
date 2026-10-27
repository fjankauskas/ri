import Link from "next/link";
import { PurchaseForm } from "@/components/Buy";
import { Card, ActionLink, FilterMenu, SearchBar, Empty } from "@/components/ui";
import { setOffer } from "@/app/actions";
import { n, priceLabel } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const key = (o: any) => `${o.partner_id}|${o.product_id}`;

export default async function MarketView({ sb, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/network", { ...P, v: "market" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), c = P.c ?? "", sel = P.offer ?? "";
  const canWrite = role !== "VIEWER";
  const [offers, mine, prods, pos] = await Promise.all([
    sb.rpc("partner_offers"),
    sb.from("stock_offers").select("qty, product_id, products(name, unit, price, price_per)"),
    sb.from("products").select("id, name, unit").eq("is_active", true).order("name"),
    sb.from("inventory_positions").select("product_id, quantity, reserved").gt("quantity", 0),
  ]);
  const OFF = (offers.data as any[]) ?? [], M = (mine.data as any[]) ?? [], PR = (prods.data as any[]) ?? [];
  const avail = new Map<string, number>();
  for (const x of (pos.data as any[]) ?? []) avail.set(x.product_id, (avail.get(x.product_id) ?? 0) + Number(x.quantity) - Number(x.reserved));
  const partners = Array.from(new Map(OFF.map((o) => [o.partner_id, o.partner])).entries());
  const rows = OFF.filter((o) => (!q || o.partner.toLowerCase().includes(q) || o.product.toLowerCase().includes(q)) && (!c || o.partner_id === c));
  const cur = OFF.find((o) => key(o) === sel);
  const back = L({ offer: null });
  const hidden = <input type="hidden" name="back" value={back} />;

  const main = (
    <div>
      {offers.error && <p role="alert" className="mb-4 text-bad">Ejecutá las migraciones 0004 a 0006 en Supabase para ver y pedir stock de tus socios.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/network" keep={{ v: "market", c: c || undefined }} q={P.q} placeholder="Buscar empresa o producto…" />
        <FilterMenu label="Empresa" value={c || "all"} options={[{ key: "all", label: "Todas", href: L({ c: null }) }, ...partners.map(([id, name]) => ({ key: id, label: name, href: L({ c: id }) }))]} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Empresa</th><th>Producto</th><th className="n">Disponible</th><th>Precio</th><th></th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={key(o)} aria-selected={sel === key(o)}>
              <td className="k">{o.partner}</td><td>{o.product}</td><td className="n">{n(o.qty)} {o.unit}</td>
              <td>{o.price == null ? <span className="text-mute">sin precio</span> : priceLabel(o.price, o.price_per, o.unit)}</td>
              <td className="n">{canWrite && <Link href={L({ offer: key(o) })} className="btn btn-green btn-sm no-underline">Pedir</Link>}</td>
            </tr>
          ))}
          {!rows.length && <Empty cols={5}>{OFF.length ? "Nada coincide con la búsqueda o el filtro." : "Tus socios todavía no publicaron stock. Cuando lo hagan, vas a poder pedírselo desde acá."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">Ves solo la cantidad que cada socio decidió publicar, no su stock real.</p>
    </div>
  );

  const aside = (
    <>
      {canWrite && cur && (
        <Card title={`Pedir a ${cur.partner}`} sub={`${cur.product} · hasta ${n(cur.qty)} ${cur.unit}`}>
          <PurchaseForm key={sel} offers={[cur]} back="/network?v=orders" initial={sel} closeHref={L({ offer: null })} />
        </Card>
      )}
      {canWrite && (
        <Card title="Publicar mi stock" sub="Elegí cuánto de cada producto ven tus socios. 0 retira la publicación.">
          <form className="f" action={setOffer}>
            {hidden}
            <label>Producto<select name="product" defaultValue={P.pub || undefined}>{PR.map((p) => <option key={p.id} value={p.id}>{p.name} — disponible {n(avail.get(p.id) ?? 0)} {p.unit}</option>)}</select></label>
            <label>Cantidad a publicar<input name="qty" type="number" step="any" min="0" required /></label>
            <button className="btn btn-green">Publicar</button>
          </form>
          <h3 className="mt-5 border-t border-line pt-4">Mis publicaciones</h3>
          <ul className="mt-2 grid gap-3 text-sm">
            {M.map((o) => (
              <li key={o.product_id} className="flex items-center justify-between gap-3">
                <div><p className="font-medium">{o.products.name}</p><p className="text-mute">{n(o.qty)} {o.products.unit} publicados · {o.products.price == null ? "sin precio" : priceLabel(o.products.price, o.products.price_per, o.products.unit)}</p></div>
                <form action={setOffer}>{hidden}<input type="hidden" name="product" value={o.product_id} /><input type="hidden" name="qty" value="0" /><button className="btn btn-gray btn-sm">Retirar</button></form>
              </li>
            ))}
            {!M.length && <li className="text-mute">Todavía no publicaste nada.</li>}
          </ul>
        </Card>
      )}
      <Card title="Más acciones">
        <div className="grid gap-2">
          <ActionLink href="/network?v=partners" icon="partners" tone="gray">Empresas conectadas</ActionLink>
          <ActionLink href="/network?v=orders" icon="orders" tone="gray">Mis pedidos</ActionLink>
        </div>
      </Card>
    </>
  );
  return { title: "Stock de la red", intro: "Lo que tus socios publicaron para vos, con su precio. Pedilo sin salir de esta pantalla.", main, aside };
}
