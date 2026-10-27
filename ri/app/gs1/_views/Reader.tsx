import Link from "next/link";
import Alert from "@/components/Alert";
import { ScanLink } from "@/components/ScanButton";
import { Card, Pill } from "@/components/ui";
import { resolveCode, getSettings } from "@/lib/gs1/data";
import { gtinKind, validateGtin } from "@/lib/gs1/check";
import { prefixInfo } from "@/lib/gs1/prefix";
import { toDigitalLink } from "@/lib/gs1/digitallink";
import { lgtinUrn } from "@/lib/gs1/epc";
import { n } from "@/lib/format";
import type { View, ViewCtx } from "@/lib/view";

const EXAMPLES: [string, string][] = [["GTIN-13", "4006381333931"], ["GS1-128 con lote y vencimiento", "(01)09501101530003(17)271231(10)LOTE123"], ["Peso variable", "(01)95012345678903(3103)000195"], ["SSCC", "(00)106141411234567897"], ["GS1 Digital Link", "https://id.gs1.org/01/09506000134352/10/ABC1/21/12345?17=271231"]];
export default async function ReaderView({ sb, org, P }: ViewCtx): Promise<View> {
  const code = (P.code ?? "").trim();
  const [settings, r] = await Promise.all([getSettings(sb, org.id), code ? resolveCode(sb, org.id, code) : Promise.resolve(null)]);
  const gtin = r?.elements.find((e) => e.ai === "01" || e.ai === "02")?.value, g = gtin && validateGtin(gtin).ok ? gtin : null, lot = r?.elements.find((e) => e.ai === "10")?.value;
  const dl = r?.elements.length ? toDigitalLink(r.elements.map((e) => ({ ai: e.ai, value: e.value }))) : null;
  const main = (
    <div className="grid gap-6">
      <Card title="Leer un código" sub="Escaneá con la cámara o pegá el contenido: GTIN, cadena GS1 con paréntesis, texto crudo de un lector o un Digital Link.">
        <form action="/gs1" method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="v" value="reader" />
          <label className="min-w-[16rem] flex-1">Código<input name="code" defaultValue={code} autoFocus placeholder="(01)07791234567893(17)271231(10)LOTE1" /></label>
          <button className="btn btn-green">Interpretar</button>
          <ScanLink href="/gs1?v=reader" label="📷 Escanear" className="btn btn-teal" />
        </form>
        <p className="mt-3 flex flex-wrap gap-2 text-xs text-mute">Ejemplos: {EXAMPLES.map(([l, c]) => <Link key={l} href={`/gs1?v=reader&code=${encodeURIComponent(c)}`} className="rounded-md border border-line px-2 py-1 no-underline">{l}</Link>)}</p>
      </Card>
      {r && r.errors.length > 0 && <Alert tone="danger" title="Se encontraron problemas">{r.errors.join(" · ")}</Alert>}
      {r && r.elements.length > 0 && (
        <div className="tw"><table>
          <thead><tr><th>AI</th><th>Dato</th><th>Valor</th><th>Interpretación</th><th>Estado</th></tr></thead>
          <tbody>{r.elements.map((e, i) => (
            <tr key={i}><td className="font-mono">({e.ai})</td><td className="k">{e.def?.name ?? "Desconocido"}<div className="text-xs font-normal text-mute">{e.def?.title}</div></td><td className="break-all font-mono text-sm">{e.value}</td><td>{e.display ?? "—"}</td><td>{e.errors.length ? <Pill tone="red">Error</Pill> : <Pill tone="green">Válido</Pill>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {r?.symbology && <p className="text-sm text-mute">Simbología detectada: <b>{r.symbology}</b></p>}
      {r?.kind === "gtin" && g && <Card title="Sobre este GTIN"><p className="text-sm">{gtinKind(g)} · {prefixInfo(g)?.label ?? "prefijo sin asignar"} · GTIN-14: <span className="font-mono">{g.padStart(14, "0")}</span></p></Card>}
      {dl?.url && <Card title="Equivalencias"><div className="grid gap-2 text-sm"><p><b>GS1 Digital Link:</b> <span className="break-all font-mono text-xs">{dl.url}</span></p>{g && settings.company_prefix && lot && <p><b>Clase de lote EPC:</b> <span className="break-all font-mono text-xs">{lgtinUrn(g.padStart(14, "0"), lot, settings.company_prefix.length)}</span></p>}</div></Card>}
    </div>
  );
  const aside = r ? (
    <>
      <Card title="En tu empresa">
        {r.product ? (
          <div className="grid gap-3 text-sm">
            <div><p className="text-base font-medium">{r.product.name}</p><p className="text-mute">SKU {r.product.sku}{r.level && r.level !== "UNIT" ? ` · presentación ${r.level.toLowerCase()} ×${r.unitsPerPack}` : ""}</p></div>
            {r.stock && <p>Stock total: <b>{n(r.stock.total)} {r.product.unit}</b> · disponible {n(r.stock.available)}</p>}
            {r.lot ? <p>Lote <b>{r.lot.lot_number}</b>: {n(r.lot.qty)} {r.product.unit}{r.lot.expiration_date ? ` · vence ${r.lot.expiration_date.split("-").reverse().join("/")}` : ""}</p> : lot ? <p className="out">El lote {lot} no existe para este producto.</p> : null}
            <div className="grid gap-2">
              <Link href={`/inventory?v=products&id=${r.product.id}`} className="btn btn-gray no-underline">Ver producto</Link>
              <Link href={`/inventory?v=products&modal=stock&id=${r.product.id}`} className="btn btn-teal no-underline">Ingresar stock</Link>
              <Link href="/sales?v=sales&modal=sale" className="btn btn-green no-underline">Nueva venta</Link>
              {r.lot && <Link href={`/inventory?v=trace&lot=${r.lot.id}`} className="btn btn-gray no-underline">Ver trazabilidad del lote</Link>}
              <Link href={`/gs1?v=products&id=${r.product.id}`} className="btn btn-gray no-underline">Ficha GS1</Link>
            </div>
          </div>
        ) : g ? <p className="text-sm text-mute">Ese GTIN no corresponde a ningún producto de tu empresa. Asignalo desde <Link href="/gs1?v=products">Productos GS1</Link>.</p> : r.shipment ? null : <p className="text-sm text-mute">No hay un producto asociado a este código.</p>}
        {r.shipment && <div className="mt-3 grid gap-2 text-sm"><p>Este SSCC corresponde a un envío.</p><Link href={`/network?v=shipments&ship=${r.shipment.id}`} className="btn btn-green no-underline">Abrir el envío</Link></div>}
      </Card>
    </>
  ) : undefined;
  return { title: "Lector y decodificador", intro: "Entendé qué dice cualquier código GS1 y a qué producto, lote o envío de tu empresa corresponde.", main, aside };
}
