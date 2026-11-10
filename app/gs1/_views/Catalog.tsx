import Alert from "@/components/Alert";
import OffCard from "@/components/OffCard";
import { Card, Pill, Empty, type PillTone } from "@/components/ui";
import { createProductFromOff } from "@/app/off-actions";
import { catalogOverview, lookupOff, offConfigured } from "@/lib/off/service";
import { offStatusText } from "@/lib/off/messages";
import { OFF_ATTRIBUTION, OFF_LICENSE_URL } from "@/lib/off/config";
import { myPerms } from "@/lib/perms-server";
import { when } from "@/lib/format";
import type { View, ViewCtx } from "@/lib/view";

const ST: Record<string, [string, PillTone]> = { running: ["En curso", "blue"], completed: ["Completada", "green"], failed: ["Falló", "red"], interrupted: ["Interrumpida", "amber"] };
const ALERT: Record<string, string> = { import_failed: "Falló una importación", count_drop: "Bajó la cantidad de productos", api_down: "Open Food Facts no responde", rate_limited: "Límite de consultas alcanzado", validation_errors: "Muchos registros rechazados" };
export default async function CatalogView({ sb, org, role, P }: ViewCtx): Promise<View> {
  const perms = await myPerms(sb, org.id, role), gtin = (P.gtin ?? "").trim();
  const ov = await catalogOverview().catch((e: any) => ({ counts: { total: 0, argentina: 0 }, runs: [] as any[], alerts: [] as any[], error: String(e?.message ?? e) }));
  const res = gtin ? await lookupOff(gtin) : null, configured = offConfigured(), last = ov.runs.find((r: any) => r.status === "completed");
  const main = (
    <div className="grid gap-6">
      {ov.error && <Alert tone="danger" title="No se pudo leer el catálogo">{ov.error}. ¿Ejecutaste la migración 0012?</Alert>}
      {ov.alerts.length > 0 && <Alert tone="warning" title="Alertas del catálogo">{ov.alerts.map((a: any) => `${ALERT[a.kind] ?? a.kind}: ${a.message}`).join(" · ")}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        {([["Productos en el catálogo", ov.counts.total.toLocaleString("es-AR"), "Con GTIN válido"], ["Asociados a Argentina", ov.counts.argentina.toLocaleString("es-AR"), "Según Open Food Facts"], ["Última sincronización", last ? when(last.finished_at ?? last.started_at) : "Nunca", last ? (last.kind === "full" ? "Importación completa" : "Cambios diarios") : "Ver cómo ejecutarla abajo"]] as [string, string, string][]).map(([l, v, h]) => (
          <div key={l} className="rounded-xl border border-line bg-card p-5"><p className="text-sm text-mute">{l}</p><p className="mt-2 text-2xl font-light">{v}</p><p className="mt-1 text-xs text-mute">{h}</p></div>
        ))}
      </div>
      <Card title="Probar un código" sub="Busca primero en el catálogo local y, si falta, consulta a Open Food Facts (una consulta por código, con caché).">
        <form action="/gs1" method="get" className="flex flex-wrap items-end gap-3"><input type="hidden" name="v" value="catalog" />
          <label className="min-w-[14rem] flex-1">GTIN<input name="gtin" defaultValue={gtin} inputMode="numeric" placeholder="7798419930133" /></label><button className="btn btn-green">Buscar</button></form>
        {!configured && <p className="mt-3 text-sm out">Falta configurar OFF_CONTACT_EMAIL: sin un contacto no se consulta a Open Food Facts (solo funciona el catálogo local).</p>}
        {res && (res.status === "local" || res.status === "found") ? (
          <div className="mt-4 border-t border-line pt-4"><OffCard p={res.product} fromCatalog={res.status === "local"} />
            {perms.can("inventory", "create") && <form action={createProductFromOff} className="mt-4"><input type="hidden" name="back" value="/gs1?v=catalog" /><input type="hidden" name="gtin" value={gtin} /><button className="btn btn-teal">Crear un producto en mi empresa con estos datos</button></form>}</div>
        ) : res && <p className={`mt-4 text-sm ${res.status === "not_found" ? "text-mute" : "out"}`} role="status">{offStatusText(res)}</p>}
      </Card>
      <div><h2 className="mb-3">Últimas sincronizaciones</h2><div className="tw"><table>
        <thead><tr><th>Inicio</th><th>Tipo</th><th>Estado</th><th className="n">Procesados</th><th className="n">Nuevos</th><th className="n">Actualizados</th><th className="n">Sin cambios</th><th className="n">Rechazados</th><th className="n">Errores</th></tr></thead>
        <tbody>{ov.runs.map((r: any) => <tr key={r.id}><td>{when(r.started_at)}</td><td>{r.kind === "full" ? "Completa" : "Cambios"}</td><td><Pill tone={ST[r.status]?.[1] ?? "gray"}>{ST[r.status]?.[0] ?? r.status}</Pill>{r.error_summary && <div className="max-w-xs text-xs text-mute">{r.error_summary}</div>}</td><td className="n">{r.processed}</td><td className="n">{r.inserted}</td><td className="n">{r.updated}</td><td className="n">{r.unchanged}</td><td className="n">{r.rejected}</td><td className="n">{r.errors}</td></tr>)}
          {!ov.runs.length && <Empty cols={9}>Todavía no se ejecutó ninguna sincronización.</Empty>}</tbody>
      </table></div></div>
    </div>
  );
  const aside = (
    <>
      <Card title="Cómo se actualiza" sub="Open Food Facts pide no recorrer su base con la API: la carga masiva usa sus exportaciones oficiales.">
        <ol className="grid gap-2 text-sm text-mute"><li><b>1.</b> Verificá las exportaciones: <code>npx tsx scripts/off-sync.ts check</code></li><li><b>2.</b> Primera carga (varios minutos): <code>npx tsx scripts/off-sync.ts full</code></li><li><b>3.</b> Cada día: <code>npx tsx scripts/off-sync.ts auto</code> (se puede automatizar con GitHub Actions).</li></ol>
        <p className="mt-3 text-xs text-mute">El detalle está en CATALOGO-OPEN-FOOD-FACTS.md.</p>
      </Card>
      <Card title="Procedencia y licencia"><p className="text-sm text-mute">{OFF_ATTRIBUTION}</p><p className="mt-2 text-sm"><a href={OFF_LICENSE_URL} target="_blank" rel="noreferrer">Licencia ODbL 1.0</a></p><p className="mt-2 text-xs text-mute">Los datos se guardan aparte de los tuyos y de los de GS1, con su fuente y fecha. Antes de redistribuir o combinar esta base con otras, hay que revisar las obligaciones de la licencia.</p></Card>
    </>
  );
  return { title: "Catálogo público", intro: "Productos asociados a Argentina de Open Food Facts, identificados por GTIN y con su procedencia.", main, aside };
}
