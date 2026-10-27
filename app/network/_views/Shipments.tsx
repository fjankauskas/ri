import Link from "next/link";
import Modal from "@/components/Modal";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, FormFooter, Stepper, Empty, type Step } from "@/components/ui";
import { ship, receive } from "@/app/actions";
import { n, when, posValue, posLabel, POS_P } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const FILTERS: [string, string][] = [["all", "Todos"], ["in", "Entradas"], ["out", "Salidas"], ["transit", "En tránsito"]];

export default async function ShipmentsView({ sb, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/network", { ...P, v: "shipments" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), d = P.d ?? "all", sel = P.ship ?? "", modal = P.modal ?? "";
  const canWrite = role !== "VIEWER";
  const [ships, conns, pos, whs] = await Promise.all([
    sb.rpc("my_shipments"), sb.rpc("my_connections"),
    sb.from("inventory_positions").select(POS_P).gt("quantity", 0),
    sb.from("warehouses").select("id, name").eq("is_active", true).order("name"),
  ]);
  const S = (ships.data as any[]) ?? [], A = ((conns.data as any[]) ?? []).filter((c) => c.status === "ACTIVE");
  const X = (pos.data as any[]) ?? [], W = (whs.data as any[]) ?? [];
  const rows = S.filter((s) => (!q || s.partner.toLowerCase().includes(q) || s.product.toLowerCase().includes(q) || s.lot.toLowerCase().includes(q))
    && (d === "all" || (d === "in" ? s.direction === "IN" : d === "out" ? s.direction === "OUT" : s.status === "IN_TRANSIT")));
  const cur = S.find((s) => s.id === sel);
  const back = L({ modal: null, ship: null });
  const hidden = <input type="hidden" name="back" value={back} />;
  const stepsOf = (s: any): Step[] => [
    { title: "Despachado", detail: when(s.created_at), state: "done" },
    { title: "En tránsito", detail: s.status === "RECEIVED" ? "Llegó a destino" : "En camino al destino", state: s.status === "RECEIVED" ? "done" : "current" },
    { title: "Recibido", detail: s.status === "RECEIVED" ? `Se recibieron ${n(s.qty_received)} ${s.unit}${s.qty_received < s.qty_shipped ? ` (faltaron ${n(s.qty_shipped - s.qty_received)})` : ""}` : "Pendiente de confirmación", state: s.status === "RECEIVED" ? "done" : "todo" },
  ];

  const main = (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/network" keep={{ v: "shipments", d: d === "all" ? undefined : d }} q={P.q} placeholder="Buscar por empresa, producto o lote…" />
        <FilterMenu label="Mostrar" value={d} options={FILTERS.map(([key, label]) => ({ key, label, href: L({ d: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Sentido</th><th>Empresa</th><th>Producto y lote</th><th className="n">Enviado</th><th className="n">Recibido</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} aria-selected={sel === s.id}>
              <td>{s.direction === "OUT" ? "Salida" : "Entrada"}</td><td className="k">{s.partner}</td>
              <td>{s.product} · <Link href={`/inventory?v=trace&q=${encodeURIComponent(s.lot)}`}>{s.lot}</Link></td>
              <td className="n">{n(s.qty_shipped)} {s.unit}</td>
              <td className="n">{s.qty_received == null ? "—" : n(s.qty_received)}{s.qty_received != null && s.qty_received < s.qty_shipped && <span className="out"> (−{n(s.qty_shipped - s.qty_received)})</span>}</td>
              <td><Pill tone={s.status === "RECEIVED" ? "green" : "blue"}>{s.status === "RECEIVED" ? "Recibido" : "En tránsito"}</Pill></td>
              <td className="n">
                {canWrite && s.direction === "IN" && s.status === "IN_TRANSIT"
                  ? <Link href={L({ ship: s.id })} className="btn btn-green btn-sm no-underline">Recibir</Link>
                  : <Link href={L({ ship: s.id })} className="text-sm">Detalle</Link>}
              </td>
            </tr>
          ))}
          {!rows.length && <Empty cols={7}>{S.length ? "Ningún envío coincide con la búsqueda o el filtro." : "Todavía no hay envíos. Se generan al despachar un pedido o al enviar stock a una empresa conectada."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">Si recibís menos de lo enviado, la diferencia queda registrada en el desempeño del proveedor.</p>

      {canWrite && modal === "ship" && (
        <Modal title="Despachar a una empresa" closeHref={back}>
          <form className="f" action={ship}>
            {hidden}
            <label>Existencia<select name="position" required>{X.map((p) => <option key={posValue(p)} value={posValue(p)}>{posLabel(p)}</option>)}</select></label>
            <label>Destino<select name="to_org" required>{A.map((c) => <option key={c.partner_id} value={c.partner_id}>{c.partner}</option>)}</select></label>
            <label>Cantidad<input name="qty" type="number" step="any" min="0" required /></label>
            <p className="text-sm text-mute">Para stock reservado por un pedido usá «Despachar» desde Pedidos.</p>
            <FormFooter submit="Despachar" closeHref={back} />
          </form>
        </Modal>
      )}
    </div>
  );

  const aside = (
    <>
      {canWrite && (
        <Card title="Acciones" sub="Qué podés hacer con tus envíos.">
          <div className="grid gap-2">
            <ActionLink href={L({ modal: "ship" })} icon="truck">Despachar a una empresa</ActionLink>
            <ActionLink href="/network?v=orders" icon="orders" tone="gray">Ver pedidos</ActionLink>
          </div>
        </Card>
      )}
      {cur && (
        <Card title={cur.direction === "IN" ? "Envío entrante" : "Envío saliente"} sub={`${cur.product} · lote ${cur.lot} · ${cur.partner}`}>
          <Stepper steps={stepsOf(cur)} />
          {canWrite && cur.direction === "IN" && cur.status === "IN_TRANSIT" && (
            <form className="f mt-5 border-t border-line pt-5" action={receive}>
              {hidden}
              <input type="hidden" name="ship" value={cur.id} />
              <label>Depósito de destino<select name="warehouse" required>{W.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
              <label>Cantidad recibida ({cur.unit})<input name="qty" type="number" step="any" min="0" defaultValue={cur.qty_shipped} required /></label>
              <button className="btn btn-green">Confirmar recepción</button>
            </form>
          )}
          <Link href={L({ ship: null })} className="mt-4 inline-block text-sm">Cerrar detalle</Link>
        </Card>
      )}
    </>
  );
  return { title: "Envíos", intro: "Mercadería que despachaste y que te están enviando. Confirmá lo que llega.", main, aside };
}
