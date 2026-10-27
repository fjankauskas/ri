import { ctx } from "@/lib/ctx";
import PrintButton from "@/components/PrintButton";
import { buildElementString } from "@/lib/gs1/ai";
import { toGtin14 } from "@/lib/gs1/check";
import { renderSymbol, type Symbology } from "@/lib/gs1/render";
import { getSettings } from "@/lib/gs1/data";
import type { SP } from "@/components/Shell";

const yymmdd = (iso: string | null) => (iso ? iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) : "");
const dmy = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const RETAIL: Record<number, Symbology> = { 13: "ean13", 12: "upca", 8: "ean8", 14: "itf14" };
const fit = "[&>svg]:h-auto [&>svg]:max-w-full [&>svg]:mx-auto";

// Hoja de etiquetas A4 (3 × 7) de un producto/lote, o etiqueta logística GS1 (SSCC) de un envío. Siempre blanco y negro para imprimir.
export default async function PrintPage({ searchParams }: { searchParams: SP }) {
  const P = await searchParams, { sb, org } = await ctx(), settings = await getSettings(sb, org.id);
  let body: React.ReactNode, page = "A4", error = "";
  try {
    if (P.kind === "sscc") {
      const { data: s } = await sb.from("shipments").select("id, sscc, qty_shipped, products(name, unit, gtin), lots(lot_number, expiration_date)").eq("id", P.ship ?? "").maybeSingle();
      if (!s?.sscc) throw new Error("El envío no existe o todavía no tiene SSCC.");
      const to = ((await sb.rpc("my_shipments")).data as any[] | null)?.find((x) => x.id === s.id)?.partner ?? "—";
      const prod = (s as any).products, lot = (s as any).lots, qty = Number(s.qty_shipped), g = prod?.gtin && /^\d{8,14}$/.test(prod.gtin) ? toGtin14(prod.gtin) : null;
      const content = g && Number.isInteger(qty) && qty > 0 ? buildElementString([{ ai: "02", value: g }, { ai: "37", value: String(qty) }, ...(lot?.expiration_date ? [{ ai: "17", value: yymmdd(lot.expiration_date) }] : []), { ai: "10", value: lot?.lot_number ?? "" }]) : "";
      const [c, sc] = await Promise.all([content ? renderSymbol("gs1-128", content) : null, renderSymbol("gs1-128", `(00)${s.sscc}`)]);
      page = "100mm 150mm";
      body = (
        <div className="mx-auto flex h-[150mm] w-[100mm] flex-col border border-black bg-white p-[4mm] text-[3.4mm] text-black print:border-0">
          <section className="border-b border-black pb-[2mm]"><p className="text-[2.6mm]">DE</p><p className="font-semibold">{org.display_name}</p>{settings.gln && <p className="text-[2.6mm]">GLN {settings.gln}</p>}<p className="mt-[1.5mm] text-[2.6mm]">PARA</p><p className="font-semibold">{to}</p></section>
          <section className="flex-1 border-b border-black py-[2mm]"><p className="text-[2.6mm]">CONTENIDO</p><p className="font-semibold">{prod?.name}</p><p>{Number.isInteger(qty) ? qty : qty.toLocaleString("es-AR")} {prod?.unit}{lot ? ` · Lote ${lot.lot_number}` : ""}{lot?.expiration_date ? ` · Vence ${dmy(lot.expiration_date)}` : ""}</p>
            {c ? <div className={`mt-[2mm] ${fit}`} dangerouslySetInnerHTML={{ __html: c.svg }} /> : <p className="mt-[2mm] text-[2.6mm]">Sin código de contenido: el producto no tiene GTIN o la cantidad no es entera.</p>}</section>
          <section className="pt-[2mm]"><p className="text-[2.6mm]">SSCC</p><div className={fit} dangerouslySetInnerHTML={{ __html: sc.svg }} /></section>
        </div>
      );
    } else {
      const { data: p } = await sb.from("products").select("id, name, sku, gtin").eq("id", P.p ?? "").eq("organization_id", org.id).maybeSingle();
      if (!p?.gtin) throw new Error("Elegí un producto con GTIN.");
      const lotNo = (P.lot ?? "").trim(), serial = (P.serial ?? "").trim(), { data: lr } = lotNo ? await sb.from("lots").select("lot_number, expiration_date").eq("product_id", p.id).eq("lot_number", lotNo).maybeSingle() : { data: null };
      const items = [{ ai: "01", value: toGtin14(p.gtin) }, ...(lr?.expiration_date ? [{ ai: "17", value: yymmdd(lr.expiration_date) }] : []), ...(lotNo ? [{ ai: "10", value: lotNo }] : []), ...(serial ? [{ ai: "21", value: serial }] : [])];
      const sym = P.sym === "retail" ? RETAIL[p.gtin.length] : (P.sym as Symbology) || "gs1-128", r = await renderSymbol(sym, RETAIL[p.gtin.length] === sym ? p.gtin : buildElementString(items), sym === "ean13" || sym === "upca" || sym === "ean8" ? { xDimMm: 0.33 } : { xDimMm: 0.33, heightMm: 12 });
      const n = Math.min(105, Math.max(1, Number(P.n) || 21));
      body = (
        <div className="mx-auto grid w-[190.5mm] grid-cols-3 print:mt-[15mm]">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="flex h-[38.1mm] w-[63.5mm] flex-col justify-between overflow-hidden bg-white p-[2.5mm] text-[2.6mm] leading-tight text-black outline outline-1 -outline-offset-1 outline-gray-300 print:outline-0">
              <p className="truncate font-semibold">{p.name}</p>
              <div className={`${fit} [&>svg]:max-h-[18mm]`} dangerouslySetInnerHTML={{ __html: r.svg }} />
              <p className="truncate">{lotNo ? `Lote ${lotNo}` : p.sku}{lr?.expiration_date ? ` · Vence ${dmy(lr.expiration_date)}` : ""}{serial ? ` · N/S ${serial}` : ""}</p>
            </div>
          ))}
        </div>
      );
    }
  } catch (e: any) { error = e.message; }
  return (
    <div className="min-h-screen bg-gray-200 px-4 py-6 print:bg-white print:p-0">
      <style>{`@page { size: ${page}; margin: 0 }`}</style>
      <div className="mx-auto mb-4 flex max-w-[820px] items-center justify-between print:hidden"><a href="/gs1?v=labels" className="text-sm">← Volver</a><PrintButton /></div>
      {error ? <p className="mx-auto max-w-[820px] rounded-lg bg-white p-6 text-red-700">{error}</p> : body}
      <p className="mx-auto mt-4 max-w-[820px] text-center text-xs text-gray-600 print:hidden">Imprimí al 100 % (sin «ajustar a la página») para respetar el tamaño real de los códigos.</p>
    </div>
  );
}
