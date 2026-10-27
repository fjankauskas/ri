import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { ctx } from "@/lib/ctx";
import PrintButton from "@/components/PrintButton";
import { CBTE, COND_IVA, DOC_TIPO, EMISOR_LABEL, IVA_OPTIONS, cbteNumber, pad } from "@/lib/billing";
import { money, n, day } from "@/lib/format";

const LETTER: Record<number, string> = { 1: "A", 2: "A", 3: "A", 6: "B", 7: "B", 8: "B", 11: "C", 12: "C", 13: "C" };
const cuitFmt = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
const ivaLabel = (k: string) => (IVA_OPTIONS.find((o) => o.key === k)?.label ?? k).replace("IVA ", "");

// Comprobante imprimible (se imprime o se guarda como PDF desde el navegador). Siempre en blanco y negro sobre fondo blanco.
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb } = await ctx();
  const { data: inv } = await sb.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) notFound();
  const [{ data: rel }, { data: sale }] = await Promise.all([
    inv.related_invoice_id ? sb.from("invoices").select("cbte_tipo, pto_vta, cbte_nro").eq("id", inv.related_invoice_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("sales").select("customers(address)").eq("id", inv.sale_id).maybeSingle(),
  ]);
  const qr = await QRCode.toDataURL(inv.qr_url, { margin: 1, width: 220 });
  const e = inv.emisor as any, letter = LETTER[inv.cbte_tipo] ?? "?", discriminated = letter !== "C";
  const isNc = inv.kind === "CREDIT_NOTE", items = (inv.items as any[]) ?? [], alic = (inv.alic as any[]) ?? [];
  const address = (sale as any)?.customers?.address as string | undefined;
  return (
    <div className="min-h-screen bg-gray-200 px-4 py-6 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[820px] items-center justify-between print:hidden">
        <a href="/sales?v=invoices" className="text-sm">← Volver a comprobantes</a><PrintButton />
      </div>
      <article className="mx-auto max-w-[820px] bg-white p-8 text-sm text-black shadow print:shadow-none">
        {inv.environment === "homologacion" && <p className="mb-4 border-2 border-dashed border-red-600 p-2 text-center font-bold text-red-700">COMPROBANTE DE PRUEBA — SIN VALIDEZ FISCAL (ambiente de homologación)</p>}
        <header className="grid grid-cols-[1fr_5rem_1fr] border border-black">
          <div className="p-4"><p className="text-lg font-semibold">{e.legal_name}</p><p>{e.address}</p><p className="mt-1">{EMISOR_LABEL[e.iva_condition as keyof typeof EMISOR_LABEL] ?? e.iva_condition}</p></div>
          <div className="flex flex-col items-center justify-start border-x border-black pt-2"><span className="text-4xl font-bold">{letter}</span><span className="text-[10px]">COD. {pad(inv.cbte_tipo, 3)}</span></div>
          <div className="p-4"><p className="text-lg font-semibold">{(CBTE[inv.cbte_tipo] ?? "Comprobante").replace(/ [ABC]$/, "").toUpperCase()}</p><p>N° {cbteNumber(inv.pto_vta, inv.cbte_nro)}</p><p>Fecha: {day(inv.cbte_fch)}</p><p className="mt-1">CUIT: {cuitFmt(e.cuit)}</p>{e.gross_income && <p>Ingresos Brutos: {e.gross_income}</p>}{e.activity_start && <p>Inicio de actividades: {day(e.activity_start)}</p>}</div>
        </header>
        <section className="mt-3 border border-black p-3">
          <p><b>Cliente:</b> {inv.receptor_nombre}</p>
          <p><b>{DOC_TIPO[inv.doc_tipo] ?? "Doc."}:</b> {inv.doc_tipo === 99 ? "—" : inv.doc_tipo === 80 ? cuitFmt(inv.doc_nro) : inv.doc_nro} · <b>Condición IVA:</b> {COND_IVA[inv.receptor_iva]}</p>
          {address && <p><b>Domicilio:</b> {address}</p>}
          {isNc && rel && <p><b>Comprobante asociado:</b> {CBTE[rel.cbte_tipo]} {cbteNumber(rel.pto_vta, rel.cbte_nro)}</p>}
        </section>
        <table className="mt-3 w-full border-collapse border border-black">
          <thead><tr className="bg-gray-100 text-left"><th className="border border-black p-2">Descripción</th><th className="border border-black p-2 text-right">Cant.</th><th className="border border-black p-2 text-right">{discriminated ? "Precio unit. (neto)" : "Precio unit."}</th>{discriminated && <th className="border border-black p-2 text-right">IVA</th>}<th className="border border-black p-2 text-right">{discriminated ? "Subtotal neto" : "Subtotal"}</th></tr></thead>
          <tbody>{items.map((i, k) => (
            <tr key={k}><td className="border border-black p-2">{i.description}</td><td className="border border-black p-2 text-right">{n(i.qty)}</td><td className="border border-black p-2 text-right">{money(i.unit_price)}</td>{discriminated && <td className="border border-black p-2 text-right">{ivaLabel(i.iva)}</td>}<td className="border border-black p-2 text-right">{money(i.net)}</td></tr>
          ))}</tbody>
        </table>
        <div className="ml-auto mt-3 w-72 text-right">
          {discriminated && <>
            <p className="flex justify-between"><span>Subtotal neto gravado</span><span>{money(inv.imp_neto)}</span></p>
            {alic.filter((a) => a.rate > 0 || a.importe > 0).map((a) => <p key={a.id} className="flex justify-between"><span>IVA {String(a.rate).replace(".", ",")} %</span><span>{money(a.importe)}</span></p>)}
            {Number(inv.imp_op_ex) > 0 && <p className="flex justify-between"><span>Exento</span><span>{money(inv.imp_op_ex)}</span></p>}
            {Number(inv.imp_tot_conc) > 0 && <p className="flex justify-between"><span>No gravado</span><span>{money(inv.imp_tot_conc)}</span></p>}
          </>}
          <p className="mt-1 flex justify-between border-t border-black pt-1 text-base font-bold"><span>TOTAL</span><span>{money(inv.imp_total)}</span></p>
          {letter === "B" && <p className="mt-1 text-xs text-gray-700">Régimen de Transparencia Fiscal al Consumidor (Ley 27.743) — IVA contenido: {money(inv.imp_iva)}</p>}
        </div>
        <footer className="mt-6 flex items-end justify-between gap-4 border-t border-black pt-4">
          <img src={qr} alt="Código QR de ARCA para verificar el comprobante" width={110} height={110} />
          <div className="text-right"><p className="font-bold">Comprobante Autorizado</p><p>CAE N°: {inv.cae}</p><p>Vencimiento del CAE: {day(inv.cae_vto)}</p></div>
        </footer>
      </article>
    </div>
  );
}
