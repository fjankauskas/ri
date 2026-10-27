import { supabaseServer } from "@/lib/supabase/server";
import { fromDigitalLink } from "@/lib/gs1/digitallink";
import { validateGtin } from "@/lib/gs1/check";
import { UOM } from "@/lib/gs1/master";
import { COUNTRIES } from "@/lib/gs1/master";

// Resolvedor público de GS1 Digital Link: /id/01/{GTIN}[/10/{lote}[/21/{serie}]][?17=AAMMDD]. No requiere sesión y solo muestra
// datos de producto y lote de empresas que activaron las páginas públicas (nunca stock ni precios).
const dmy = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
export const metadata = { title: "Verificación de producto", robots: { index: false } };

export default async function Resolver({ params, searchParams }: { params: Promise<{ path: string[] }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { path } = await params, sp = await searchParams;
  const url = new URL(`https://resolvedor.local/${path.map((s) => encodeURIComponent(dec(s))).join("/")}`);
  for (const [k, v] of Object.entries(sp)) if (v) url.searchParams.set(k, v);
  const dl = fromDigitalLink(url.toString()), val = (ai: string) => dl.elements.find((e) => e.ai === ai)?.value;
  const gtin = val("01"), lot = val("10"), serial = val("21"), expiryAi = dl.elements.find((e) => e.ai === "17")?.display;
  let r: any = null;
  if (gtin && validateGtin(gtin).ok) { const sb = await supabaseServer(); const res = await sb.rpc("gs1_resolve", { p_gtin: gtin, p_lot: lot ?? null }); r = res.data; }
  const m = r?.master ?? {}, expiry: string | null = r?.lot?.expiration_date ?? (expiryAi && !expiryAi.includes("sin día") ? expiryAi : null);
  const expired = expiry ? new Date(expiry) < new Date(new Date().toDateString()) : false;
  const country = COUNTRIES.find(([c]) => c === m.origin_country)?.[1];
  const ld = r?.found ? { "@context": "https://schema.org/", "@type": "Product", gtin, name: r.name, ...(m.brand ? { brand: { "@type": "Brand", name: m.brand } } : {}), ...(m.image_url ? { image: m.image_url } : {}), manufacturer: { "@type": "Organization", name: r.organization } } : null;
  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <p className="mb-6 text-sm text-mute">Verificación de producto · GS1 Digital Link</p>
      {!dl.ok && <div className="rounded-xl border border-line bg-card p-6"><h1 className="text-2xl">Enlace no válido</h1><p className="mt-2 text-mute">{dl.errors[0] ?? "No se pudo interpretar el código."}</p></div>}
      {dl.ok && r && !r.found && <div className="rounded-xl border border-line bg-card p-6"><h1 className="text-2xl">Producto no publicado</h1><p className="mt-2 text-mute">El GTIN <span className="font-mono">{gtin}</span> {r.reason === "invalid" ? "no es válido." : "no está publicado por ninguna empresa en esta plataforma."}</p></div>}
      {r?.found && (
        <article className="rounded-xl border border-line bg-card p-6">
          {m.image_url && <img src={m.image_url} alt={r.name} referrerPolicy="no-referrer" loading="lazy" className="mb-5 max-h-56 w-auto rounded-lg bg-white object-contain p-2" />}
          <h1 className="text-3xl">{r.name}</h1>
          {m.brand && <p className="mt-1 text-lg text-mute">{m.brand}</p>}
          <p className="mt-1 text-sm text-mute">Elaborado o distribuido por <b>{r.organization}</b></p>
          <dl className="mt-6 grid gap-3 text-sm">
            {([["GTIN", gtin], ...(r.level !== "UNIT" ? [["Presentación", `${r.level === "CASE" ? "Caja" : r.level === "PALLET" ? "Pallet" : "Pack"} × ${r.units_per_pack}`]] : []), ...(m.net_content ? [["Contenido neto", `${m.net_content} ${UOM[m.net_content_uom] ?? m.net_content_uom ?? ""}`]] : []), ...(country ? [["País de origen", country]] : []), ...(m.shelf_life_days ? [["Vida útil", `${m.shelf_life_days} días`]] : []), ...(m.storage_min_c != null || m.storage_max_c != null ? [["Almacenamiento", `${m.storage_min_c ?? "—"} a ${m.storage_max_c ?? "—"} °C`]] : [])] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-line pb-2"><dt className="text-mute">{k}</dt><dd className="text-right font-mono">{v}</dd></div>)}
          </dl>
          {(lot || serial || expiry) && (
            <section className="mt-6 rounded-lg border border-line p-4">
              <h2 className="mb-2 text-lg">Lote</h2>
              <dl className="grid gap-2 text-sm">
                {lot && <div className="flex justify-between gap-4"><dt className="text-mute">Número de lote</dt><dd className="font-mono">{lot}{r.lot ? "" : " (no registrado)"}</dd></div>}
                {serial && <div className="flex justify-between gap-4"><dt className="text-mute">Número de serie</dt><dd className="font-mono">{serial}</dd></div>}
                {r.lot?.production_date && <div className="flex justify-between gap-4"><dt className="text-mute">Producción</dt><dd>{dmy(r.lot.production_date)}</dd></div>}
                {expiry && <div className="flex justify-between gap-4"><dt className="text-mute">Vencimiento</dt><dd className={expired ? "out font-medium" : ""}>{dmy(expiry)}{expired ? " · VENCIDO" : ""}</dd></div>}
              </dl>
            </section>
          )}
          {m.product_url && /^https?:\/\//i.test(m.product_url) && <p className="mt-6"><a href={m.product_url} rel="noopener noreferrer">Sitio del producto →</a></p>}
          <p className="mt-6 text-xs text-mute"><a href={`/api/gs1/resolve?gtin=${gtin}${lot ? `&lot=${encodeURIComponent(lot)}` : ""}`}>Datos en formato JSON</a></p>
        </article>
      )}
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />}
    </main>
  );
}
