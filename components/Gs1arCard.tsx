import { Pill } from "@/components/ui";
import type { Gs1arProduct } from "@/lib/gs1ar/normalize";
const Row = ({ k, v }: { k: string; v?: React.ReactNode }) => (v ? <div className="flex justify-between gap-4 border-b border-line pb-2 text-sm"><dt className="text-mute">{k}</dt><dd className="break-words text-right">{v}</dd></div> : null);
const Sec = ({ t, children }: { t: string; children: React.ReactNode }) => <section className="mt-4"><h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mute">{t}</h3><dl className="grid gap-2">{children}</dl></section>;
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };
/** Ficha oficial de un producto según GS1 Argentina. */
export default function Gs1arCard({ p, cached, fetchedAt, refreshHref }: { p: Gs1arProduct; cached: boolean; fetchedAt: string; refreshHref?: string }) {
  const active = /^activ/i.test(p.estado);
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-lg font-medium">{p.descripcion || p.gtin}</p><p className="text-sm text-mute">{[p.marca, p.submarca, p.variedad].filter(Boolean).join(" · ")}</p></div>
        {p.estado && <Pill tone={active ? "green" : "amber"}>{p.estado}</Pill>}
      </div>
      {p.imagenes[0] && <img src={p.imagenes[0]} alt={p.descripcion} referrerPolicy="no-referrer" loading="lazy" className="mt-3 max-h-48 w-auto rounded-lg bg-white object-contain p-2" />}
      <Sec t="Producto">
        <Row k="GTIN" v={<span className="font-mono">{p.gtin}</span>} /><Row k="Contenido neto" v={p.contenidoNeto != null ? `${p.contenidoNeto} ${p.unidadMedida}` : undefined} /><Row k="Envase" v={p.envase} /><Row k="País de fabricación" v={p.paisFabricacion} />
        <Row k="Código interno" v={p.codigoInterno} /><Row k="Registro SENASA" v={p.nroRegSenasa} />
        {p.pack && <Row k={`Presentación ${p.pack.gtin14}`} v={`${p.pack.envase} ${p.pack.unidades != null ? `× ${p.pack.unidades}` : ""}`} />}
      </Sec>
      {(p.segmento || p.ladrillo) && <Sec t="Clasificación GPC"><Row k="Segmento" v={p.segmento} /><Row k="Familia" v={p.familia} /><Row k="Clase" v={p.clase} /><Row k="Ladrillo" v={p.ladrillo} /></Sec>}
      <Sec t="Empresa titular"><Row k="Razón social" v={p.razonSocial} /><Row k="CUIT" v={p.cuit} /><Row k="Licencia" v={p.licencia ? `${p.licencia}${p.tipoLicencia ? ` (${p.tipoLicencia})` : ""}` : undefined} /><Row k="GLN principal" v={p.glnPrincipal} /><Row k="Organización GS1" v={p.mo} /><Row k="Dirección" v={p.direccion} /><Row k="Sitio web" v={p.website} /></Sec>
      {p.mercados.length > 0 && <Sec t="Mercados de destino"><dd className="flex flex-wrap gap-1">{p.mercados.map((m) => <Pill key={m.codigo + m.nombre} tone="blue">{m.nombre || m.codigo}</Pill>)}</dd></Sec>}
      {p.octogonos.length > 0 && <Sec t="Octógonos de advertencia"><dd className="flex flex-wrap gap-1">{p.octogonos.map((o) => <Pill key={o} tone="amber">{o}</Pill>)}</dd></Sec>}
      {p.links.length > 0 && <Sec t="Enlaces registrados">{p.links.map((l, i) => <div key={i} className="text-sm"><span className="font-medium">{l.tipo || "Enlace"}</span>{l.principal && <Pill tone="green">Principal</Pill>}<span className="block break-all text-xs text-mute">{l.url}</span></div>)}</Sec>}
      <p className="mt-4 text-xs text-mute">Fuente: {p.source || "GS1 Argentina"} · consultado {ago(fetchedAt)}{cached ? " (copia guardada)" : ""}{refreshHref && <> · <a href={refreshHref}>Actualizar ahora</a></>}</p>
    </div>
  );
}
