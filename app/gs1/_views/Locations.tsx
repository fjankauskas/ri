import Link from "next/link";
import { ScanLink } from "@/components/ScanButton";
import { Card, Pill, Empty } from "@/components/ui";
import { saveWarehouseGln, assignSscc } from "@/app/gs1-actions";
import { getSettings } from "@/lib/gs1/data";
import { sglnUrn } from "@/lib/gs1/epc";
import { glnDigitalLink } from "@/lib/gs1/epc";
import { n, when } from "@/lib/format";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

export default async function LocationsView({ sb, org, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/gs1", { ...P, v: "locations" }, patch);
  const canEdit = ["OWNER", "ADMIN", "INVENTORY_MANAGER"].includes(role), canShip = canEdit || role === "SALES", whSel = P.wh ?? "", ssccQ = (P.sscc ?? "").replace(/\D/g, "");
  const [settings, { data: whs }, ship, { data: own }] = await Promise.all([
    getSettings(sb, org.id),
    sb.from("warehouses").select("id, name, gln").eq("organization_id", org.id).eq("is_active", true).order("name"),
    sb.rpc("my_shipments"), sb.from("shipments").select("id, sscc, created_at").eq("from_org", org.id),
  ]);
  const W = (whs as any[]) ?? [], cp = settings.company_prefix?.length ?? null, S = new Map(((own as any[]) ?? []).map((x) => [x.id, x.sscc as string | null]));
  const out = ((ship.data as any[]) ?? []).filter((s) => s.direction === "OUT");
  const cur = W.find((w) => w.id === whSel);
  const found = ssccQ ? (await sb.from("shipments").select("id, sscc, status").eq("sscc", ssccQ).maybeSingle()).data : null;
  const main = (
    <div className="grid gap-8">
      <div>
        <h2 className="mb-3">Ubicaciones (GLN)</h2>
        <div className="tw"><table>
          <thead><tr><th>Ubicación</th><th>GLN</th><th>SGLN (EPC)</th><th></th></tr></thead>
          <tbody>
            <tr><td className="k">{org.display_name}<div className="text-xs font-normal text-mute">Empresa</div></td><td className="font-mono text-sm">{settings.gln ?? <span className="text-mute">—</span>}</td><td className="break-all font-mono text-xs text-mute">{settings.gln && cp ? sglnUrn(settings.gln, cp) : "—"}</td><td className="n"><Link href="/gs1?v=config" className="text-sm">Configurar</Link></td></tr>
            {W.map((w) => (
              <tr key={w.id} aria-selected={whSel === w.id}>
                <td className="k">{w.name}<div className="text-xs font-normal text-mute">Depósito</div></td><td className="font-mono text-sm">{w.gln ?? <span className="text-mute">—</span>}</td>
                <td className="break-all font-mono text-xs text-mute">{w.gln && cp ? sglnUrn(w.gln, cp) : "—"}</td><td className="n"><Link href={L({ wh: w.id })}>Gestionar</Link></td>
              </tr>
            ))}
            {!W.length && <Empty cols={4}>Todavía no hay depósitos. Creá uno en Inventario.</Empty>}
          </tbody>
        </table></div>
      </div>
      <div>
        <h2 className="mb-3">Unidades logísticas (SSCC) de tus envíos</h2>
        <div className="tw"><table>
          <thead><tr><th>Fecha</th><th>Destino</th><th>Contenido</th><th className="n">Cantidad</th><th>SSCC</th><th></th></tr></thead>
          <tbody>
            {out.map((s) => {
              const sscc = S.get(s.id);
              return (
                <tr key={s.id}>
                  <td>{when(s.created_at)}</td><td className="k">{s.partner}</td><td>{s.product} · {s.lot}</td><td className="n">{n(s.qty_shipped)} {s.unit}</td>
                  <td>{sscc ? <span className="font-mono text-sm">{sscc}</span> : <Pill tone="gray">Sin SSCC</Pill>}</td>
                  <td>
                    <div className="flex items-center justify-end gap-3">
                      {sscc ? <a href={`/gs1-print?kind=sscc&ship=${s.id}`} target="_blank" rel="noreferrer" className="btn btn-teal btn-sm no-underline">Etiqueta</a>
                        : canShip && <form action={assignSscc}><input type="hidden" name="back" value={L()} /><input type="hidden" name="shipment" value={s.id} /><button className="btn btn-green btn-sm">Asignar SSCC</button></form>}
                      <Link href={`/network?v=shipments&ship=${s.id}`} className="text-sm">Envío</Link>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!out.length && <Empty cols={6}>Todavía no despachaste mercadería a otras empresas.</Empty>}
          </tbody>
        </table></div>
        <p className="mt-3 text-sm text-mute">El SSCC identifica de forma única cada bulto o pallet. Se imprime en la etiqueta logística (GS1-128) y quien recibe puede escanearlo para encontrar el envío.</p>
      </div>
    </div>
  );
  const aside = (
    <>
      {cur && canEdit && (
        <Card title={`GLN de ${cur.name}`}>
          <form action={saveWarehouseGln} className="f">
            <input type="hidden" name="back" value={L({ wh: null })} /><input type="hidden" name="warehouse" value={cur.id} />
            <label>GLN (13 dígitos)<input name="gln" defaultValue={cur.gln ?? ""} inputMode="numeric" /></label>
            <label className="flex items-center gap-2 font-normal text-mute"><input type="checkbox" name="auto" /> Generarlo con mi prefijo y el siguiente número</label>
            {cur.gln && <p className="text-xs text-mute">Digital Link: <span className="break-all font-mono">{glnDigitalLink(cur.gln)}</span></p>}
            <button className="btn btn-green">Guardar GLN</button>
          </form>
        </Card>
      )}
      <Card title="Buscar por SSCC" sub="Escaneá la etiqueta de un bulto o escribí el número.">
        <form action="/gs1" method="get" className="f">
          <input type="hidden" name="v" value="locations" />
          <label>SSCC (18 dígitos)<input name="sscc" defaultValue={ssccQ} inputMode="numeric" /></label>
          <div className="flex gap-2"><button className="btn btn-green">Buscar</button><ScanLink href="/gs1?v=reader" label="📷 Escanear" className="btn btn-teal" /></div>
        </form>
        {ssccQ && (found ? <p className="mt-3 text-sm">Encontrado: <Link href={`/network?v=shipments&ship=${found.id}`}>abrir el envío →</Link></p> : <p className="mt-3 text-sm text-mute">No hay ningún envío con ese SSCC visible para tu empresa.</p>)}
      </Card>
    </>
  );
  return { title: "Ubicaciones y logística", intro: "Identificá tus depósitos con GLN y tus bultos con SSCC; imprimí la etiqueta logística GS1.", main, aside };
}
