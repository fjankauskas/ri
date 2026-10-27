import Alert from "@/components/Alert";
import { Card } from "@/components/ui";
import { buildEpcis } from "@/lib/gs1/epcis";
import { getSettings, loadEpcisRows } from "@/lib/gs1/data";
import type { View, ViewCtx } from "@/lib/view";

export default async function DataView({ sb, org, P }: ViewCtx): Promise<View> {
  const from = P.from || "", to = P.to || "", q = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  let error = "", r: ReturnType<typeof buildEpcis> | null = null, total = 0;
  const settings = await getSettings(sb, org.id);
  try { const rows = await loadEpcisRows(sb, from || undefined, to || undefined); total = rows.length; r = buildEpcis(rows, settings); } catch (e: any) { error = e.message; }
  const main = (
    <div className="grid gap-6">
      <Card title="Período" sub="Filtrá los movimientos que querés exportar (hora de Argentina).">
        <form action="/gs1" method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="v" value="data" />
          <label>Desde<input type="date" name="from" defaultValue={from} /></label><label>Hasta<input type="date" name="to" defaultValue={to} /></label>
          <button className="btn btn-green">Aplicar</button>
        </form>
      </Card>
      {error && <Alert tone="danger" title="No se pudieron leer los movimientos">{error}</Alert>}
      {r && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {([["Movimientos en el período", total], ["Eventos EPCIS generados", r.mapped], ["Movimientos omitidos", r.unmapped]] as [string, number][]).map(([l, v]) => (
              <div key={l} className="rounded-xl border border-line bg-card p-5"><p className="text-sm text-mute">{l}</p><p className="mt-2 text-3xl font-light">{v}</p></div>
            ))}
          </div>
          {r.unmapped > 0 && <Alert tone="warning" title="Algunos movimientos no se pudieron convertir">{Object.entries(r.reasons).map(([k, v]) => `${v} × ${k}`).join(" · ")}. Asignales un GTIN válido desde «Productos GS1» para incluirlos.</Alert>}
          {!settings.company_prefix && <Alert tone="info" title="Sin prefijo de empresa">Los identificadores salen en formato GS1 Digital Link. Con el prefijo cargado se usan los URN EPC estándar (LGTIN y SGLN).</Alert>}
        </>
      )}
      <Card title="Qué contiene la exportación EPCIS">
        <ul className="grid gap-2 text-sm text-mute">
          <li><b>EPCIS 2.0 (JSON-LD, ISO/IEC 19987):</b> cada movimiento es un evento con «qué» (GTIN + lote), «cuándo», «dónde» (GLN del depósito) y «por qué» (paso de negocio y disposición del vocabulario CBV).</li>
          <li><b>Recepciones, despachos, transferencias, ventas y ajustes</b> salen como eventos de objeto; <b>la producción</b> sale como evento de transformación (insumos → producto terminado).</li>
          <li>Es el formato que los socios y los sistemas de trazabilidad (por ejemplo, de salud o alimentos) esperan recibir.</li>
        </ul>
      </Card>
    </div>
  );
  const aside = (
    <>
      <Card title="Descargas" sub="Todo con identificadores GS1.">
        <div className="grid gap-2">
          <a className="btn btn-green no-underline" href={`/api/epcis?${q}${q ? "&" : ""}download=1`}>EPCIS 2.0 (JSON-LD)</a>
          <a className="btn btn-teal no-underline" href="/api/gs1/export?format=csv">Fichas de producto (CSV)</a>
          <a className="btn btn-gray no-underline" href="/api/gs1/export?format=jsonld">Fichas de producto (JSON-LD)</a>
          <a className="btn btn-gray no-underline" href={`/api/epcis?${q}`} target="_blank" rel="noreferrer">Ver EPCIS en el navegador</a>
        </div>
      </Card>
      <Card title="Páginas públicas">
        <p className="text-sm text-mute">{settings.public_enabled ? "Activadas: cada producto con GTIN tiene su ficha pública en /id/01/{GTIN} y /id/01/{GTIN}/10/{lote}, la dirección que codifica el QR de GS1 Digital Link." : "Desactivadas. Activalas en «Configuración» para que el QR de GS1 Digital Link muestre la ficha del producto y del lote."}</p>
      </Card>
    </>
  );
  return { title: "EPCIS y datos", intro: "Exportá tus movimientos como eventos EPCIS 2.0 y tus fichas de producto para compartirlas.", main, aside };
}
