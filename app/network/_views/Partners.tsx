import Link from "next/link";
import Modal from "@/components/Modal";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, FormFooter, Empty, type PillTone } from "@/components/ui";
import { connect, accept, createInvite } from "@/app/actions";
import { n } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const FILTERS: [string, string][] = [["all", "Todas"], ["active", "Activas"], ["pending", "Pendientes"]];

export default async function PartnersView({ sb, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/network", { ...P, v: "partners" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), f = P.f ?? "all", modal = P.modal ?? "";
  const canWrite = role !== "VIEWER";
  const [conns, card] = await Promise.all([sb.rpc("my_connections"), sb.rpc("supplier_scorecard")]);
  const C = (conns.data as any[]) ?? [];
  const score = new Map<string, any>(((card.data as any[]) ?? []).map((c) => [c.partner, c]));
  const state = (c: any): [string, PillTone] => (c.status === "ACTIVE" ? ["Activa", "green"] : c.incoming ? ["Te invitó", "blue"] : ["Pendiente", "amber"]);
  const rows = C.filter((c) => (!q || c.partner.toLowerCase().includes(q)) && (f === "all" || (f === "active" ? c.status === "ACTIVE" : c.status !== "ACTIVE")));
  const back = L({ modal: null });
  const hidden = <input type="hidden" name="back" value={back} />;
  const main = (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/network" keep={{ v: "partners", f: f === "all" ? undefined : f }} q={P.q} placeholder="Buscar empresa…" />
        <FilterMenu label="Estado" value={f} options={FILTERS.map(([key, label]) => ({ key, label, href: L({ f: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Empresa</th><th>Estado</th><th className="n">Envíos recibidos</th><th className="n">Faltante</th><th className="n">Pendientes</th><th></th></tr></thead>
        <tbody>
          {rows.map((c) => {
            const sc = score.get(c.partner), [label, tone] = state(c);
            return (
              <tr key={c.id}>
                <td className="k">{c.partner}</td><td><Pill tone={tone}>{label}</Pill></td>
                <td className="n">{sc ? sc.shipments : "—"}</td>
                <td className={`n ${sc && Number(sc.diff_pct) > 0 ? "out" : ""}`}>{sc?.diff_pct == null ? "—" : `${n(sc.diff_pct)}%`}</td>
                <td className="n">{sc ? sc.pending : "—"}</td>
                <td>
                  <div className="flex items-center justify-end gap-3">
                    {canWrite && c.status === "PENDING" && c.incoming && <form action={accept}>{hidden}<input type="hidden" name="id" value={c.id} /><button className="btn btn-green btn-sm">Aceptar</button></form>}
                    {c.status === "ACTIVE" && <Link href={`/network?v=market&c=${c.partner_id}`} className="text-sm">Ver su stock</Link>}
                  </div>
                </td>
              </tr>
            );
          })}
          {!rows.length && <Empty cols={6}>{C.length ? "Ninguna empresa coincide con la búsqueda o el filtro." : "Todavía no tenés conexiones. Conectate por CUIT o invitá a una empresa desde las acciones de la derecha."}</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">«Faltante» compara lo enviado con lo que recibiste de cada proveedor. Cumplimiento calculado sobre los envíos que ya confirmaste.</p>

      {canWrite && modal === "connect" && (
        <Modal title="Conectar con una empresa" closeHref={back}>
          <form className="f" action={connect}>
            {hidden}
            <label>CUIT de la empresa<input name="tax_id" required inputMode="numeric" autoFocus /></label>
            <p className="text-sm text-mute">Le llega una solicitud; cuando la acepte podrán pedirse stock y enviarse mercadería.</p>
            <FormFooter submit="Enviar solicitud" closeHref={back} />
          </form>
        </Modal>
      )}
      {canWrite && modal === "invite" && (
        <Modal title="Invitar a una empresa" closeHref={back}>
          <form className="f" action={createInvite}>
            {hidden}
            <label>Email de la empresa<input name="email" type="email" required autoFocus /></label>
            <p className="text-sm text-mute">Para empresas que todavía no usan la plataforma: reciben un enlace para crear su cuenta y conectarse con vos.</p>
            <FormFooter submit="Invitar" closeHref={back} />
          </form>
        </Modal>
      )}
    </div>
  );
  const aside = canWrite ? (
    <Card title="Acciones" sub="Qué podés hacer con tus empresas.">
      <div className="grid gap-2">
        <ActionLink href={L({ modal: "connect" })} icon="plus">Conectar por CUIT</ActionLink>
        <ActionLink href={L({ modal: "invite" })} icon="partners" tone="teal">Invitar por email</ActionLink>
        <ActionLink href="/network?v=market" icon="market" tone="gray">Ver stock de la red</ActionLink>
      </div>
    </Card>
  ) : undefined;
  return { title: "Empresas conectadas", intro: "Tus clientes y proveedores, y qué tan bien cumplen sus envíos.", main, aside };
}
