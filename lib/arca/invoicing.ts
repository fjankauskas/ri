import { computeTotals, pickCbte, type Emisor, type Totals, type Alic } from "../billing";
import { isValidCuit } from "./cuit";
import { errText, type Auth, type Msg } from "./wsfe";
import { issue } from "./issue";
import { qrUrl } from "./qr";
import type { Env } from "./wsaa";

export type Profile = { cuit: string; legal_name: string; iva_condition: Emisor; address: string | null; gross_income: string | null; activity_start: string | null };
export type CustomerRow = { name: string; doc_type: number; doc_number: string; iva_condition: number } | null;
export type ItemRow = { description: string; qty: number | string; unit_price: number | string; iva: string };
export type InvoiceRow = {
  organization_id: string; sale_id: string; kind: "INVOICE" | "CREDIT_NOTE"; related_invoice_id: string | null; environment: Env;
  cbte_tipo: number; pto_vta: number; cbte_nro: number; cbte_fch: string; doc_tipo: number; doc_nro: string; receptor_nombre: string; receptor_iva: number;
  imp_total: number; imp_neto: number; imp_iva: number; imp_tot_conc: number; imp_op_ex: number; alic: Alic[]; items: { description: string; qty: number; unit_price: number; iva: string; net: number }[];
  cae: string; cae_vto: string; observaciones: Msg[]; qr_url: string; emisor: Record<string, unknown>; created_by: string;
};
export type Ports = {
  claim(): Promise<boolean>;                                          // toma el "candado" para que nadie emita dos veces
  release(error: string, keepLocked: boolean): Promise<void>;         // suelta el candado (keepLocked = resultado incierto)
  saveInvoice(row: InvoiceRow): Promise<string>;
  markDone(): Promise<void>;
  log(action: string, ok: boolean, request: unknown, response: unknown, error?: string): Promise<void>;
  getAuth(): Promise<Auth>;
};

/** Fecha de hoy en Argentina (YYYY-MM-DD), sin depender de la zona horaria del servidor. */
export const arDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function receptorOf(c: CustomerRow) {
  return c ? { docTipo: c.doc_type, docNro: c.doc_type === 99 ? "0" : c.doc_number.replace(/\D/g, ""), ivaCond: c.iva_condition, name: c.name } : { docTipo: 99, docNro: "0", ivaCond: 5, name: "Consumidor Final" };
}
export function validateReceptor(clase: "A" | "B" | "C", r: ReturnType<typeof receptorOf>) {
  if (clase === "A" && (r.docTipo !== 80 || !isValidCuit(r.docNro))) throw new Error("Para una Factura A el cliente debe tener un CUIT válido. Revisá sus datos en «Clientes».");
  if (r.docTipo === 80 && !isValidCuit(r.docNro)) throw new Error(`El CUIT del cliente (${r.docNro}) no es válido.`);
  if ((r.docTipo === 96 || r.docTipo === 86) && !/^\d{7,11}$/.test(r.docNro)) throw new Error("El documento del cliente no es válido.");
}
const emisorSnapshot = (p: Profile, ptoVta: number) => ({ cuit: p.cuit, legal_name: p.legal_name, iva_condition: p.iva_condition, address: p.address, gross_income: p.gross_income, activity_start: p.activity_start, pto_vta: ptoVta });
const rejection = (kind: string, errores: Msg[], obs: Msg[]) => `ARCA rechazó ${kind}: ${errText(errores) || errText(obs) || "sin detalle"}`;

type Common = { env: Env; profile: Profile; ptoVta: number; orgId: string; saleId: string; userId: string; today?: Date; ports: Ports };

/** Ejecuta `work` con el candado tomado y lo libera según el resultado (rechazo seguro vs. corte de red incierto). */
async function locked<T>(a: Common, what: string, work: (sent: { v: boolean }) => Promise<T>): Promise<T> {
  if (!(await a.ports.claim())) throw new Error(`${what} ya fue emitida o se está procesando. Si pasaron más de 5 minutos, reintentá.`);
  const sent = { v: false }; let released = false;
  try { return await work(sent); }
  catch (e: any) {
    if (!released) {
      released = true;
      const msg = sent.v && !/ARCA rechaz|se emitió en ARCA/.test(String(e.message)) ? `No se pudo confirmar con ARCA si se emitió (${e.message}). Verificá en «Mis comprobantes» de ARCA antes de reintentar.` : String(e.message);
      await a.ports.release(msg, sent.v && !/ARCA rechaz/.test(String(e.message)));
      throw new Error(msg);
    }
    throw e;
  }
}

function toRow(a: Common, o: { kind: "INVOICE" | "CREDIT_NOTE"; related: string | null; tipo: number; nro: number; fecha: string; receptor: ReturnType<typeof receptorOf>; totals: Totals; items: InvoiceRow["items"]; cae: string; caeVto: string; obs: Msg[] }): InvoiceRow {
  return {
    organization_id: a.orgId, sale_id: a.saleId, kind: o.kind, related_invoice_id: o.related, environment: a.env, cbte_tipo: o.tipo, pto_vta: a.ptoVta, cbte_nro: o.nro, cbte_fch: o.fecha,
    doc_tipo: o.receptor.docTipo, doc_nro: o.receptor.docNro, receptor_nombre: o.receptor.name, receptor_iva: o.receptor.ivaCond,
    imp_total: o.totals.total, imp_neto: o.totals.neto, imp_iva: o.totals.iva, imp_tot_conc: o.totals.totConc, imp_op_ex: o.totals.opEx, alic: o.totals.alic, items: o.items,
    cae: o.cae, cae_vto: o.caeVto, observaciones: o.obs, emisor: emisorSnapshot(a.profile, a.ptoVta), created_by: a.userId,
    qr_url: qrUrl({ fecha: o.fecha, cuit: Number(a.profile.cuit), ptoVta: a.ptoVta, tipoCmp: o.tipo, nroCmp: o.nro, importe: o.totals.total, moneda: "PES", ctz: 1, tipoDocRec: o.receptor.docTipo, nroDocRec: Number(o.receptor.docNro), codAut: Number(o.cae) }),
  };
}

/** Factura una venta: arma importes, elige A/B/C, pide el CAE y guarda el comprobante. */
export async function invoiceSaleCore(a: Common & { items: ItemRow[]; customer: CustomerRow }) {
  const receptor = receptorOf(a.customer), { tipo, clase } = pickCbte(a.profile.iva_condition, receptor.ivaCond, "INVOICE");
  validateReceptor(clase, receptor);
  const lines = a.items.map((i) => ({ qty: Number(i.qty), unit_price: Number(i.unit_price), iva: i.iva }));
  const totals = computeTotals(lines, a.profile.iva_condition);
  if (!(totals.total > 0)) throw new Error("El total de la venta debe ser mayor que cero para poder facturar.");
  const snapshot = a.items.map((i, k) => ({ description: i.description, qty: lines[k].qty, unit_price: lines[k].unit_price, iva: i.iva, net: Math.round(lines[k].qty * lines[k].unit_price * 100) / 100 }));
  const fecha = arDate(a.today);
  return locked(a, "Esta venta", async (sent) => {
    const auth = await a.ports.getAuth();
    const out = await issue({ env: a.env, auth, ptoVta: a.ptoVta, tipo, clase, fecha: fecha.replace(/-/g, ""), receptor, totals, onSend: () => { sent.v = true; } });
    await a.ports.log("FECAESolicitar", out.approved, out.request, out.result, out.approved ? undefined : errText(out.result.errores));
    if (!out.approved) throw new Error(rejection("el comprobante", out.result.errores, out.result.observaciones));
    const row = toRow(a, { kind: "INVOICE", related: null, tipo, nro: out.nro, fecha, receptor, totals, items: snapshot, cae: out.result.cae!, caeVto: out.result.caeVto!, obs: out.result.observaciones });
    let id: string;
    try { id = await a.ports.saveInvoice(row); }
    catch (e: any) { throw new Error(`La factura se emitió en ARCA (comprobante ${out.nro}, CAE ${row.cae}) pero no se pudo guardar: ${e.message}`); }
    await a.ports.markDone();
    return { id, row };
  });
}

export type StoredInvoice = Pick<InvoiceRow, "cbte_tipo" | "pto_vta" | "cbte_nro" | "cbte_fch" | "doc_tipo" | "doc_nro" | "receptor_nombre" | "receptor_iva" | "imp_total" | "imp_neto" | "imp_iva" | "imp_tot_conc" | "imp_op_ex" | "alic" | "items"> & { id: string };
/** Nota de crédito por el total de una factura (anula la operación). Lleva la factura como comprobante asociado. */
export async function creditNoteCore(a: Common & { invoice: StoredInvoice }) {
  const inv = a.invoice, clase = ({ 1: "A", 6: "B", 11: "C" } as Record<number, "A" | "B" | "C">)[inv.cbte_tipo];
  if (!clase) throw new Error("Solo se pueden anular facturas A, B o C con una nota de crédito.");
  const totals: Totals = { neto: Number(inv.imp_neto), iva: Number(inv.imp_iva), totConc: Number(inv.imp_tot_conc), opEx: Number(inv.imp_op_ex), total: Number(inv.imp_total), alic: inv.alic };
  const receptor = { docTipo: inv.doc_tipo, docNro: inv.doc_nro, ivaCond: inv.receptor_iva, name: inv.receptor_nombre };
  const fecha = arDate(a.today);
  return locked({ ...a, ptoVta: inv.pto_vta }, "La nota de crédito de esta factura", async (sent) => {
    const auth = await a.ports.getAuth();
    const out = await issue({ env: a.env, auth, ptoVta: inv.pto_vta, tipo: inv.cbte_tipo + 2, clase, fecha: fecha.replace(/-/g, ""), receptor, totals,
      asoc: { tipo: inv.cbte_tipo, ptoVta: inv.pto_vta, nro: Number(inv.cbte_nro), cuit: a.profile.cuit, fecha: String(inv.cbte_fch).replace(/-/g, "") }, onSend: () => { sent.v = true; } });
    await a.ports.log("FECAESolicitar (NC)", out.approved, out.request, out.result, out.approved ? undefined : errText(out.result.errores));
    if (!out.approved) throw new Error(rejection("la nota de crédito", out.result.errores, out.result.observaciones));
    const row = toRow({ ...a, ptoVta: inv.pto_vta }, { kind: "CREDIT_NOTE", related: inv.id, tipo: inv.cbte_tipo + 2, nro: out.nro, fecha, receptor, totals, items: inv.items, cae: out.result.cae!, caeVto: out.result.caeVto!, obs: out.result.observaciones });
    let id: string;
    try { id = await a.ports.saveInvoice(row); }
    catch (e: any) { throw new Error(`La nota de crédito se emitió en ARCA (comprobante ${out.nro}, CAE ${row.cae}) pero no se pudo guardar: ${e.message}`); }
    await a.ports.markDone();
    return { id, row };
  });
}
