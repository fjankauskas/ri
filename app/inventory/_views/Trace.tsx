import Link from "next/link";
import Modal from "@/components/Modal";
import Scanner from "@/components/Scanner";
import { Card, ActionLink, SearchBar, Stepper, Empty, type Step } from "@/components/ui";
import { when, day, n, TYPES } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

export default async function TraceView({ sb, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/inventory", { ...P, v: "trace" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), lot = P.lot ?? "";
  const { data: lots } = await sb.from("lots").select("id, lot_number, expiration_date, product_id, products(name, unit)").order("lot_number").limit(500);
  const chain = lot ? ((await sb.rpc("trace_lot", { p_lot: lot })).data as any[] | null) ?? [] : null;
  const all = (lots as any[]) ?? [];
  const found = all.filter((l) => !q || l.lot_number.toLowerCase().includes(q) || l.products.name.toLowerCase().includes(q)).slice(0, 30);
  const cur = all.find((l) => l.id === lot);
  const steps: Step[] = (chain ?? []).map((e) => ({
    state: "done",
    title: `${TYPES[e.event_type] ?? e.event_type} · ${e.product} ${e.lot}`,
    detail: `${when(e.occurred_at)} · ${e.org}${e.mine ? ` · ${e.from_wh ?? "Externo"} → ${e.to_wh ?? "Externo"} · ${n(e.qty)} ${e.unit}` : " (otra empresa, cantidad oculta)"}`,
  }));
  const main = (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar action="/inventory" keep={{ v: "trace" }} q={P.q} placeholder="Buscar lote por producto o número…" />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Producto</th><th>Lote</th><th>Vence</th><th></th></tr></thead>
        <tbody>
          {found.map((l) => (
            <tr key={l.id} aria-selected={l.id === lot}>
              <td className="k">{l.products.name}</td><td>{l.lot_number}</td><td>{day(l.expiration_date)}</td>
              <td className="n"><Link href={L({ lot: l.id, modal: null })}>Ver recorrido</Link></td>
            </tr>
          ))}
          {!found.length && <Empty cols={4}>{all.length ? "Ningún lote coincide con la búsqueda." : "Todavía no hay lotes. Se crean al ingresar stock o producir."}</Empty>}
        </tbody>
      </table></div>
      {lot && (
        <Card title={cur ? `Recorrido de ${cur.products.name} · lote ${cur.lot_number}` : "Recorrido del lote"}
          sub={`${(chain ?? []).length} eventos en ${new Set((chain ?? []).map((e) => e.org)).size} empresa(s). Hacia atrás (de qué lotes salió) y hacia adelante (a quién llegó), incluso entre empresas.`}>
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              {steps.length ? <Stepper steps={steps} /> : <p className="text-mute">Ese lote no tiene recorrido visible para tu empresa.</p>}
            </div>
            <img src={`/api/qr?lot=${lot}`} alt="Código QR del lote" width={120} height={120} className="rounded-lg bg-white p-1" />
          </div>
        </Card>
      )}
      {P.modal === "scan" && <Modal title="Escanear lote" closeHref={L({ modal: null })}><Scanner /></Modal>}
    </div>
  );
  const aside = (
    <Card title="Acciones" sub="Qué podés hacer con la trazabilidad.">
      <div className="grid gap-2">
        <ActionLink href={L({ modal: "scan" })} icon="scan">Escanear QR del lote</ActionLink>
        <a href="/api/epcis" className="btn btn-teal w-full justify-start no-underline">Exportar eventos EPCIS</a>
        {lot && <a href={`/api/qr?lot=${lot}`} target="_blank" rel="noreferrer" className="btn btn-gray w-full justify-start no-underline">Imprimir etiqueta QR</a>}
        {cur && <ActionLink href={`/inventory?v=products&id=${cur.product_id}`} icon="box" tone="gray">Ver producto</ActionLink>}
      </div>
    </Card>
  );
  return { title: "Trazabilidad", intro: "Buscá un lote o escaneá su QR para ver de dónde vino y a dónde fue.", main, aside };
}
