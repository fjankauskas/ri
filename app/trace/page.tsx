import { ctx } from "@/lib/ctx";
import Shell, { type SP } from "@/components/Shell";
import { n, when, TYPES } from "@/lib/format";
export default async function Trace({ searchParams }: { searchParams: SP }) {
  const { sb, org } = await ctx();
  const { lot } = await searchParams;
  const { data: lots } = await sb.from("lots").select("id, lot_number, products(name)").order("lot_number").limit(500);
  const chain = lot ? (await sb.rpc("trace_lot", { p_lot: lot })).data as any[] | null : null;
  return (
    <Shell org={org.display_name} sp={searchParams}>
      <section><h2>Trazabilidad de lote</h2><p className="mu">Hacia atrás (de qué lotes salió) y hacia adelante (a quién llegó), incluso entre empresas. Las cantidades de otras empresas están ocultas.</p>
        <form className="f" method="get"><label>Lote<select name="lot" defaultValue={lot}>{(lots as any[] ?? []).map((l) => <option key={l.id} value={l.id}>{l.products.name} · {l.lot_number}</option>)}</select></label><button className="p">Ver recorrido</button></form></section>
      {lot && <section><h2>Recorrido</h2><p className="mu">{(chain ?? []).length} eventos en {new Set((chain ?? []).map((e) => e.org)).size} empresa(s). Cada lote de la cadena es un eslabón: producción (insumo → producto) y envíos entre empresas.</p>
        <img src={`/api/qr?lot=${lot}`} alt="QR del lote" width={120} height={120} style={{ float: "right", background: "#fff" }} />
        <table><thead><tr><th>Fecha</th><th>Empresa</th><th>Evento</th><th>Producto y lote</th><th>Recorrido</th><th className="n">Cantidad</th></tr></thead><tbody>
          {(chain ?? []).map((e) => <tr key={e.id}><td>{when(e.occurred_at)}</td><td>{e.org}</td><td>{TYPES[e.event_type]}</td><td>{e.product} · {e.lot}</td>
            <td>{e.mine ? `${e.from_wh ?? "Externo"} → ${e.to_wh ?? "Externo"}` : <span className="mu">otra empresa</span>}</td><td className="n">{e.mine ? `${n(e.qty)} ${e.unit}` : "—"}</td></tr>)}
          {!chain?.length && <tr><td colSpan={6} className="mu">Ese lote no tiene recorrido visible para tu empresa.</td></tr>}</tbody></table></section>}
    </Shell>
  );
}
