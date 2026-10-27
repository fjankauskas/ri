import Link from "next/link";
import Alert from "@/components/Alert";
import { Card, Pill } from "@/components/ui";
import { parseElementString, buildElementString } from "@/lib/gs1/ai";
import { toGtin14 } from "@/lib/gs1/check";
import { renderSymbol, SYMBOLOGIES, type Symbology } from "@/lib/gs1/render";
import { mk } from "@/lib/url";
import type { View, ViewCtx } from "@/lib/view";

const yymmdd = (iso: string | null) => (iso ? iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) : "");
const RETAIL: Record<number, Symbology> = { 13: "ean13", 12: "upca", 8: "ean8", 14: "itf14" };
type Item = { title: string; use: string; type: Symbology; data: string };

async function card(it: Item, extra?: string) {
  try {
    const r = await renderSymbol(it.type, it.data);
    return (
      <div key={it.title + it.data} className="rounded-xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3>{it.title}</h3><p className="text-sm text-mute">{it.use}</p></div><Link href={`/api/gs1/barcode?type=${it.type}&data=${encodeURIComponent(it.data)}&download=1`} className="btn btn-gray btn-sm no-underline">Descargar SVG</Link></div>
        <div className="mt-4 overflow-x-auto rounded-lg bg-white p-3 text-black" dangerouslySetInnerHTML={{ __html: r.svg }} />
        <p className="mt-2 break-all font-mono text-xs text-mute">{r.hri}</p>{extra && <p className="mt-1 text-xs text-mute">{extra}</p>}
      </div>
    );
  } catch (e: any) {
    return <div key={it.title + it.data} className="rounded-xl border border-line bg-card p-5"><h3>{it.title}</h3><p className="mt-2 text-sm out">{e.message}</p></div>;
  }
}

export default async function LabelsView({ sb, org, P }: ViewCtx): Promise<View> {
  const L = (patch: Record<string, string | null> = {}) => mk("/gs1", { ...P, v: "labels" }, patch);
  const manual = P.m === "manual";
  let body: React.ReactNode;
  if (!manual) {
    const [{ data: prods }, { data: packsAll }] = await Promise.all([
      sb.from("products").select("id, sku, name, gtin").eq("organization_id", org.id).eq("is_active", true).not("gtin", "is", null).order("name"),
      sb.from("product_gtins").select("product_id, gtin, level, units_per_pack").eq("organization_id", org.id),
    ]);
    const PR = (prods as any[]) ?? [], prod = PR.find((p) => p.id === P.p);
    let lots: any[] = []; if (prod) { const { data } = await sb.from("lots").select("id, lot_number, expiration_date").eq("product_id", prod.id).order("lot_number"); lots = (data as any[]) ?? []; }
    const lot = P.lot ?? "", lr = lots.find((l) => l.lot_number === lot), serial = (P.serial ?? "").trim();
    const g14 = prod ? toGtin14(prod.gtin) : "", items = prod ? [{ ai: "01", value: g14 }, ...(lr?.expiration_date ? [{ ai: "17", value: yymmdd(lr.expiration_date) }] : []), ...(lot ? [{ ai: "10", value: lot }] : []), ...(serial ? [{ ai: "21", value: serial }] : [])] : [];
    const hri = buildElementString(items), check = hri ? parseElementString(hri) : null;
    const cards: Item[] = prod ? [
      { title: "Código de barras del producto", use: "Punto de venta: lo lee la caja registradora", type: RETAIL[prod.gtin.length] ?? "itf14", data: prod.gtin },
      ...(((packsAll as any[]) ?? []).filter((k) => k.product_id === prod.id).map((k): Item => ({ title: `ITF-14 de la ${k.level === "PALLET" ? "pallet" : k.level === "INNER" ? "pack" : "caja"} ×${Number(k.units_per_pack)}`, use: "Cajas y bultos corrugados", type: "itf14", data: k.gtin }))),
      { title: "GS1-128 con lote y vencimiento", use: "Logística y depósitos", type: "gs1-128", data: hri },
      { title: "GS1 DataMatrix", use: "Productos pequeños y salud: GTIN + lote + vencimiento + serie", type: "gs1datamatrix", data: hri },
      { title: "QR con GS1 Digital Link", use: "Consumidores: el QR abre la ficha del producto y del lote", type: "gs1dl-qr", data: hri },
    ] : [];
    const rendered = await Promise.all(cards.map((c) => card(c, c.type === "gs1dl-qr" ? "Funciona con cualquier lector de QR. Activá las páginas públicas en Configuración para que el enlace muestre tu ficha." : undefined)));
    body = (
      <div className="grid gap-6">
        <Card title="Armar códigos de un producto" sub="Elegí el producto y, si querés, el lote: el vencimiento se toma del lote.">
          <form action="/gs1" method="get" className="f">
            <input type="hidden" name="v" value="labels" />
            <div className="fgrid">
              <label>Producto (solo los que tienen GTIN)<select name="p" defaultValue={P.p ?? ""}><option value="">— elegir —</option>{PR.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.gtin})</option>)}</select></label>
              <label>Lote<input name="lot" list="lotes" defaultValue={lot} placeholder="opcional" /><datalist id="lotes">{lots.map((l) => <option key={l.id} value={l.lot_number} />)}</datalist></label>
              <label>Número de serie (opcional)<input name="serial" defaultValue={serial} /></label>
            </div>
            <button className="btn btn-green justify-self-start">Generar códigos</button>
          </form>
          {!PR.length && <p className="mt-3 text-sm text-mute">Todavía no hay productos con GTIN. Asignalos en <Link href="/gs1?v=products">Productos GS1</Link>.</p>}
        </Card>
        {prod && check && !check.ok && <Alert tone="danger" title="Los datos no son válidos para GS1">{check.errors.join(" · ")}</Alert>}
        {prod && <div className="grid gap-4 xl:grid-cols-2">{rendered}</div>}
        {prod && (
          <Card title="Imprimir una hoja de etiquetas" sub="Hoja A4 de 3 × 7 (63,5 × 38,1 mm).">
            <form action="/gs1-print" method="get" target="_blank" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="p" value={prod.id} /><input type="hidden" name="lot" value={lot} /><input type="hidden" name="serial" value={serial} />
              <label>Código<select name="sym" defaultValue="gs1-128">{["gs1-128", "gs1datamatrix", "gs1dl-qr"].map((k) => <option key={k} value={k}>{SYMBOLOGIES.find((s) => s.key === k)!.label}</option>)}<option value="retail">Código de barras del producto</option></select></label>
              <label>Copias<input name="n" type="number" min="1" max="105" defaultValue="21" className="w-24!" /></label>
              <button className="btn btn-teal">Abrir hoja para imprimir</button>
            </form>
          </Card>
        )}
      </div>
    );
  } else {
    const type = (P.type as Symbology) ?? "gs1-128", def = SYMBOLOGIES.find((s) => s.key === type) ?? SYMBOLOGIES[4], data = (P.data ?? "").trim();
    const parsed = def.input === "gs1" && data ? parseElementString(data) : null;
    const out = data ? await card({ title: def.label, use: def.use, type: def.key, data }) : null;
    body = (
      <div className="grid gap-6">
        <Card title="Generador libre" sub="Escribí los datos y elegí la simbología. Los códigos GS1 se validan antes de dibujarse.">
          <form action="/gs1" method="get" className="f">
            <input type="hidden" name="v" value="labels" /><input type="hidden" name="m" value="manual" />
            <label>Simbología<select name="type" defaultValue={def.key}>{SYMBOLOGIES.map((s) => <option key={s.key} value={s.key}>{s.label} — {s.use}</option>)}</select></label>
            <label>{def.input === "key" ? "Número (con dígito de control)" : def.input === "gs1" ? "Datos GS1 con los AI entre paréntesis" : "Texto"}<input name="data" defaultValue={data} placeholder={def.input === "key" ? "4006381333931" : def.input === "gs1" ? "(01)09501101530003(17)271231(10)LOTE1" : "ABC-123"} /></label>
            <button className="btn btn-green justify-self-start">Generar</button>
          </form>
        </Card>
        {parsed && !parsed.ok && <Alert tone="danger" title="Los datos GS1 tienen errores">{parsed.errors.join(" · ")}</Alert>}
        {out}
      </div>
    );
  }
  const aside = (
    <>
      <Card title="Modo" sub="Cómo querés armar los códigos.">
        <div className="grid gap-2">
          <Link href={L({ m: null })} className={`btn no-underline ${!manual ? "btn-green" : "btn-gray"}`}>Desde un producto</Link>
          <Link href={L({ m: "manual" })} className={`btn no-underline ${manual ? "btn-green" : "btn-gray"}`}>Generador libre</Link>
        </div>
      </Card>
      <Card title="Guía de impresión">
        <ul className="grid gap-2 text-sm text-mute">
          <li><b>EAN-13 / UPC-A:</b> tamaño real = módulo de 0,33 mm; se puede ampliar o reducir entre 80 % y 200 %.</li>
          <li><b>ITF-14 y GS1-128:</b> módulo de 0,495 mm a 1,016 mm; el ITF-14 lleva marco alrededor.</li>
          <li><b>Zonas en blanco:</b> respetá el margen libre a los lados del código; si se recorta, no se lee.</li>
          <li><b>Contraste:</b> barras oscuras sobre fondo claro y mate. Probá el escaneo antes de imprimir una tirada.</li>
          <li>Los SVG se descargan a escala real (en milímetros): imprimilos sin «ajustar a la página».</li>
        </ul>
      </Card>
      <Card title="Elegí según el uso">
        <div className="grid gap-1 text-sm">{SYMBOLOGIES.filter((s) => s.input !== "text").map((s) => <p key={s.key}><Pill tone="gray">{s.label}</Pill> <span className="text-mute">{s.use}</span></p>)}</div>
      </Card>
    </>
  );
  return { title: "Códigos y etiquetas", intro: "Generá los códigos de barras y 2D de tus productos en todas las simbologías GS1.", main: body, aside };
}
