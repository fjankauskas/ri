import { Pill } from "@/components/ui";
import { OFF_ATTRIBUTION, OFF_LICENSE_URL } from "@/lib/off/config";
import { displayName } from "@/lib/off/normalize";
import type { OffRow } from "@/lib/off/store";
const day = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
/** Ficha de un producto del catálogo público de Open Food Facts, con su procedencia y licencia. */
export default function OffCard({ p, fromCatalog }: { p: OffRow; fromCatalog: boolean }) {
  const rows: [string, string | null][] = [["Nombre genérico", p.generic_name && p.generic_name !== p.product_name ? p.generic_name : null], ["Marca", p.brands], ["Cantidad", p.quantity]];
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-lg font-medium">{displayName(p)}</p><p className="font-mono text-sm text-mute">{p.code}</p></div>
        <Pill tone={p.in_argentina ? "blue" : "gray"}>{p.in_argentina ? "Asociado a Argentina en OFF" : "Sin asociación a Argentina en OFF"}</Pill>
      </div>
      <dl className="mt-3 grid gap-2">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-line pb-2 text-sm"><dt className="text-mute">{k}</dt><dd className="text-right">{v}</dd></div>)}</dl>
      <p className="mt-3 rounded-lg border border-line bg-surface p-3 text-xs text-mute">Open Food Facts es una base colaborativa. Que un producto figure asociado a Argentina no demuestra que hoy se comercialice allí, y un GTIN válido no significa que esté registrado en GS1.</p>
      <p className="mt-3 text-xs text-mute">
        Fuente: <a href={`https://world.openfoodfacts.org/product/${p.code}`} target="_blank" rel="noreferrer">Open Food Facts</a> · licencia <a href={OFF_LICENSE_URL} target="_blank" rel="noreferrer">ODbL 1.0</a> · modificado en OFF {day(p.off_last_modified_at)} · importado {day(p.imported_at)}{fromCatalog ? " (catálogo local)" : " (consultado ahora)"}.<br />{OFF_ATTRIBUTION}
      </p>
    </div>
  );
}
