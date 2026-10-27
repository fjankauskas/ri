import Link from "next/link";
import Alert from "@/components/Alert";
import { Card, Pill, ActionLink, FilterMenu, SearchBar, Empty, type PillTone } from "@/components/ui";
import { assignGtin, assignAllGtins, saveProductGtin, addPackLevel, deletePackLevel, saveMaster } from "@/app/gs1-actions";
import { getSettings } from "@/lib/gs1/data";
import { gtinKind, toGtin14, validateGtin } from "@/lib/gs1/check";
import { prefixInfo } from "@/lib/gs1/prefix";
import { renderSymbol } from "@/lib/gs1/render";
import { completeness, COUNTRIES, MARKETS, UOM, WEIGHT_UOM, DIM_UOM, CONTENT_UOM, type Master } from "@/lib/gs1/master";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const FILTERS: [string, string][] = [["all", "Todos"], ["with", "Con GTIN"], ["without", "Sin GTIN"], ["incomplete", "Ficha incompleta (<80%)"]];
const LEVEL: Record<string, string> = { INNER: "Pack", CASE: "Caja", PALLET: "Pallet" };
const tone = (p: number): PillTone => (p >= 80 ? "green" : p >= 50 ? "amber" : "red");
const sel = (name: string, options: string[], cur?: string | null) => <select name={name} defaultValue={cur ?? options[0]}>{options.map((o) => <option key={o} value={o}>{o} — {UOM[o]}</option>)}</select>;

export default async function GProductsView({ sb, org, role, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/gs1", { ...P, v: "products" }, patch);
  const q = (P.q ?? "").trim().toLowerCase(), f = P.f ?? "all", selId = P.id ?? "", canEdit = ["OWNER", "ADMIN", "INVENTORY_MANAGER"].includes(role);
  const [settings, { data: prods }, { data: masters }, { data: packs }] = await Promise.all([
    getSettings(sb, org.id),
    sb.from("products").select("id, sku, name, unit, gtin").eq("organization_id", org.id).eq("is_active", true).order("name"),
    sb.from("product_gs1").select("*").eq("organization_id", org.id), sb.from("product_gtins").select("*").eq("organization_id", org.id).order("created_at"),
  ]);
  const M = new Map(((masters as any[]) ?? []).map((m) => [m.product_id, m as Master & { product_id: string }])), K = (packs as any[]) ?? [];
  const rows = ((prods as any[]) ?? []).map((p) => ({ p, m: M.get(p.id) ?? null, packs: K.filter((k) => k.product_id === p.id), c: completeness(p, M.get(p.id)) }))
    .filter((r) => (!q || r.p.name.toLowerCase().includes(q) || r.p.sku.toLowerCase().includes(q) || (r.p.gtin ?? "").includes(q)) && (f === "all" || (f === "with" ? !!r.p.gtin : f === "without" ? !r.p.gtin : r.c.pct < 80)));
  const cur = rows.find((r) => r.p.id === selId) ?? ((prods as any[]) ?? []).map((p) => ({ p, m: M.get(p.id) ?? null, packs: K.filter((k) => k.product_id === p.id), c: completeness(p, M.get(p.id)) })).find((r) => r.p.id === selId);
  const back = L({ modal: null });
  const hidden = <input type="hidden" name="back" value={back} />;
  let preview = "", previewErr = "";
  if (cur?.p.gtin) { const t = ({ 13: "ean13", 12: "upca", 8: "ean8", 14: "itf14" } as Record<number, any>)[cur.p.gtin.length]; try { preview = (await renderSymbol(t, cur.p.gtin, { xDimMm: 0.33 })).svg; } catch (e: any) { previewErr = e.message; } }
  const g14 = cur?.p.gtin ? toGtin14(cur.p.gtin) : null, pre = cur?.p.gtin ? prefixInfo(cur.p.gtin) : null, m = cur?.m;
  const num = (k: keyof Master) => (m?.[k] ?? "") as any;

  const main = (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar action="/gs1" keep={{ v: "products", f: f === "all" ? undefined : f }} q={P.q} placeholder="Buscar por nombre, SKU o GTIN…" />
        <FilterMenu label="Mostrar" value={f} options={FILTERS.map(([key, label]) => ({ key, label, href: L({ f: key === "all" ? null : key }) }))} />
      </div>
      <div className="tw"><table>
        <thead><tr><th>Producto</th><th>GTIN</th><th>Presentaciones</th><th>GPC</th><th className="n">Ficha</th><th></th></tr></thead>
        <tbody>
          {rows.map(({ p, m, packs, c }) => (
            <tr key={p.id} aria-selected={selId === p.id}>
              <td className="k">{p.name}<div className="text-xs font-normal text-mute">{p.sku}</div></td>
              <td>{p.gtin ? <><span className="font-mono text-sm">{p.gtin}</span><div className="flex flex-wrap gap-1 pt-1"><Pill tone={validateGtin(p.gtin).ok ? "green" : "red"}>{gtinKind(p.gtin) ?? "inválido"}</Pill>{prefixInfo(p.gtin)?.kind === "restricted" && <Pill tone="amber">Interno</Pill>}</div></> : <span className="text-mute">Sin GTIN</span>}</td>
              <td>{packs.length ? <div className="flex flex-wrap gap-1">{packs.map((k) => <Pill key={k.id} tone="blue">{LEVEL[k.level]} ×{Number(k.units_per_pack)}</Pill>)}</div> : <span className="text-mute">—</span>}</td>
              <td className="font-mono text-sm">{m?.gpc_brick ?? <span className="text-mute">—</span>}</td>
              <td className="n"><Pill tone={tone(c.pct)}>{c.pct}%</Pill></td>
              <td className="n"><Link href={L({ id: p.id })}>Gestionar</Link></td>
            </tr>
          ))}
          {!rows.length && <Empty cols={6}>Ningún producto coincide con la búsqueda o el filtro.</Empty>}
        </tbody>
      </table></div>
      <p className="mt-3 text-sm text-mute">{rows.length} productos. La «ficha» mide cuántos datos maestros pide GS1 ya están cargados.</p>
    </div>
  );

  const aside = (
    <>
      {canEdit && (
        <Card title="Acciones" sub="Qué podés hacer con los códigos de tus productos.">
          <div className="grid gap-3">
            <form action={assignAllGtins} className="f rounded-lg border border-line p-3">
              {hidden}
              <label>Asignar GTIN a todos los productos sin código
                <select name="mode" defaultValue={settings.company_prefix ? "gs1" : "internal"}><option value="gs1" disabled={!settings.company_prefix}>GS1 (con tu prefijo{settings.company_prefix ? "" : ": falta cargarlo"})</option><option value="internal">Interno (uso dentro de tu empresa)</option></select></label>
              <label className="flex items-center gap-2 font-normal text-mute"><input type="checkbox" name="confirm" required /> Confirmo la asignación masiva</label>
              <button className="btn btn-green">Asignar a todos</button>
            </form>
            <ActionLink href="/gs1?v=labels" icon="barcode" tone="teal">Códigos y etiquetas</ActionLink>
            <a href="/api/gs1/export?format=csv" className="btn btn-gray no-underline">Descargar fichas (CSV)</a>
            <a href="/api/gs1/export?format=jsonld" className="btn btn-gray no-underline">Descargar fichas (JSON-LD)</a>
          </div>
        </Card>
      )}
      {cur && (
        <Card title={cur.p.name} sub={`SKU ${cur.p.sku}`}>
          <div className="grid gap-5">
            {cur.p.gtin ? (
              <div>
                <div className="rounded-lg bg-white p-2" aria-label="Código de barras del producto">{preview ? <div dangerouslySetInnerHTML={{ __html: preview }} className="[&>svg]:mx-auto [&>svg]:max-w-full [&>svg]:h-auto" /> : <p className="text-sm text-red-700">{previewErr}</p>}</div>
                <p className="mt-2 text-sm text-mute">GTIN-14 equivalente: <span className="font-mono">{g14}</span>{pre && <> · {pre.label}</>}</p>
                {settings.public_enabled && <p className="text-sm"><Link href={`/id/01/${g14}`} target="_blank">Ver página pública →</Link></p>}
              </div>
            ) : <Alert tone="warning" title="Este producto no tiene GTIN">Asignale uno para poder imprimir su código de barras.</Alert>}
            {canEdit && (<>
              <form action={saveProductGtin} className="f">
                {hidden}<input type="hidden" name="product" value={cur.p.id} />
                <label>GTIN (8, 12, 13 o 14 dígitos)<input name="gtin" defaultValue={cur.p.gtin ?? ""} inputMode="numeric" /></label>
                <button className="btn btn-gray justify-self-start">Guardar GTIN</button>
              </form>
              <form action={assignGtin} className="f border-t border-line pt-4">
                {hidden}<input type="hidden" name="product" value={cur.p.id} />
                <label>Generar un GTIN nuevo<select name="mode" defaultValue={settings.company_prefix ? "gs1" : "internal"}><option value="gs1" disabled={!settings.company_prefix}>GS1 (con tu prefijo)</option><option value="internal">Interno</option></select></label>
                {cur.p.gtin && <label className="flex items-center gap-2 font-normal text-mute"><input type="checkbox" name="replace" /> Reemplazar el GTIN actual</label>}
                <button className="btn btn-green justify-self-start">Generar</button>
              </form>
            </>)}
            <div className="border-t border-line pt-4">
              <h3 className="mb-2">Presentaciones (cajas y pallets)</h3>
              <ul className="grid gap-2 text-sm">
                {cur.packs.map((k: any) => <li key={k.id} className="flex items-center justify-between gap-2"><span><b>{LEVEL[k.level]}</b> ×{Number(k.units_per_pack)} · <span className="font-mono">{k.gtin}</span></span>{canEdit && <form action={deletePackLevel}>{hidden}<input type="hidden" name="id" value={k.id} /><button className="btn btn-gray btn-sm">Quitar</button></form>}</li>)}
                {!cur.packs.length && <li className="text-mute">Sin presentaciones. Una caja o pallet lleva su propio GTIN-14.</li>}
              </ul>
              {canEdit && cur.p.gtin && (
                <form action={addPackLevel} className="f mt-3 rounded-lg border border-line p-3">
                  {hidden}<input type="hidden" name="product" value={cur.p.id} />
                  <div className="fgrid">
                    <label>Nivel<select name="level"><option value="CASE">Caja</option><option value="INNER">Pack</option><option value="PALLET">Pallet</option></select></label>
                    <label>Unidades<input name="units" type="number" step="any" min="0" required /></label>
                    <label>Indicador (1–8)<input name="indicator" type="number" min="1" max="8" placeholder="auto" /></label>
                    <label>GTIN-14 (opcional)<input name="gtin" inputMode="numeric" placeholder="se genera solo" /></label>
                  </div>
                  <button className="btn btn-teal justify-self-start">Agregar presentación</button>
                </form>
              )}
            </div>
            <form action={saveMaster} className="f border-t border-line pt-4">
              {hidden}<input type="hidden" name="product" value={cur.p.id} />
              <h3>Datos maestros <Pill tone={tone(cur.c.pct)}>{cur.c.pct}%</Pill></h3>
              {cur.c.missing.length > 0 && <p className="text-xs text-mute">Falta: {cur.c.missing.join(", ")}</p>}
              <fieldset disabled={!canEdit} className="f">
                <label>Marca<input name="brand" defaultValue={m?.brand ?? ""} /></label>
                <label>Clasificación GPC (brick, 8 dígitos)<input name="gpc_brick" defaultValue={m?.gpc_brick ?? ""} inputMode="numeric" /></label>
                <div className="fgrid"><label>Contenido neto<input name="net_content" type="number" step="any" min="0" defaultValue={num("net_content")} /></label><label>Unidad<select name="net_content_uom" defaultValue={m?.net_content_uom ?? ""}><option value="">—</option>{CONTENT_UOM.map((o) => <option key={o} value={o}>{o}</option>)}</select></label></div>
                <div className="fgrid"><label>Peso bruto<input name="gross_weight" type="number" step="any" min="0" defaultValue={num("gross_weight")} /></label><label>Peso neto<input name="net_weight" type="number" step="any" min="0" defaultValue={num("net_weight")} /></label></div>
                <label>Unidad de peso{sel("weight_uom", WEIGHT_UOM, m?.weight_uom)}</label>
                <div className="fgrid"><label>Alto<input name="height" type="number" step="any" min="0" defaultValue={num("height")} /></label><label>Ancho<input name="width" type="number" step="any" min="0" defaultValue={num("width")} /></label><label>Profundidad<input name="depth" type="number" step="any" min="0" defaultValue={num("depth")} /></label><label>Unidad{sel("dimension_uom", DIM_UOM, m?.dimension_uom)}</label></div>
                <div className="fgrid"><label>País de origen<select name="origin_country" defaultValue={m?.origin_country ?? ""}><option value="">—</option>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}</select></label><label>Mercado objetivo<select name="target_market" defaultValue={m?.target_market ?? "032"}>{MARKETS.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}</select></label></div>
                <div className="fgrid"><label>Vida útil (días)<input name="shelf_life_days" type="number" min="0" defaultValue={num("shelf_life_days")} /></label><label>Temp. almacenamiento mín/máx (°C)<span className="flex gap-2"><input name="storage_min_c" type="number" step="any" defaultValue={num("storage_min_c")} placeholder="mín" /><input name="storage_max_c" type="number" step="any" defaultValue={num("storage_max_c")} placeholder="máx" /></span></label></div>
                <label>Sitio web del producto<input name="product_url" defaultValue={m?.product_url ?? ""} placeholder="https://" /></label>
                <label>Imagen (URL)<input name="image_url" defaultValue={m?.image_url ?? ""} placeholder="https://" /></label>
                <label>Descripción larga<textarea name="description_long" rows={3} defaultValue={m?.description_long ?? ""} /></label>
                <button className="btn btn-green justify-self-start">Guardar datos maestros</button>
              </fieldset>
            </form>
            <Link href={`/inventory?v=products&id=${cur.p.id}`} className="text-sm">Editar el producto y su stock en Inventario →</Link>
          </div>
        </Card>
      )}
    </>
  );
  return { title: "Productos GS1", intro: "El GTIN de cada producto, sus presentaciones y los datos maestros que exige el estándar.", main, aside };
}
