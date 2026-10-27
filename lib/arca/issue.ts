import { solicitarCae, ultimoAutorizado, type Auth, type CaeRequest, type CaeResult } from "./wsfe";
import type { Env } from "./wsaa";
import type { Totals } from "../billing";

export type IssueInput = {
  env: Env; auth: Auth; ptoVta: number; tipo: number; clase: "A" | "B" | "C"; fecha: string; // fecha yyyymmdd
  receptor: { docTipo: number; docNro: string; ivaCond: number }; totals: Totals;
  asoc?: CaeRequest["asoc"];
  /** Se llama justo antes de enviar el pedido de CAE: a partir de ahí un corte de red deja el resultado incierto. */
  onSend?: () => void;
};
export type IssueOutput = { approved: boolean; nro: number; request: CaeRequest; result: CaeResult };

/** Arma el pedido según la clase de comprobante. Factura C: sin IVA discriminado, ImpTotal = ImpNeto. */
export function buildRequest(i: IssueInput, nro: number): CaeRequest {
  const t = i.totals, c = i.clase === "C";
  return {
    ptoVta: i.ptoVta, tipo: i.tipo, nro, concepto: 1, docTipo: i.receptor.docTipo, docNro: i.receptor.docNro, fecha: i.fecha,
    total: t.total, totConc: c ? 0 : t.totConc, neto: t.neto, opEx: c ? 0 : t.opEx, trib: 0, iva: c ? 0 : t.iva,
    monId: "PES", monCotiz: 1, condIvaReceptor: i.receptor.ivaCond, alic: c ? [] : t.alic.map((a) => ({ id: a.id, base: a.base, importe: a.importe })), asoc: i.asoc,
  };
}

/**
 * Pide el CAE: consulta el último número autorizado, emite el siguiente y, si ARCA avisa que el número ya no es el correcto
 * (error 10016, p. ej. por una emisión simultánea), vuelve a consultarlo y reintenta una vez.
 */
export async function issue(i: IssueInput): Promise<IssueOutput> {
  let nro = (await ultimoAutorizado(i.env, i.auth, i.ptoVta, i.tipo)) + 1;
  let request = buildRequest(i, nro);
  i.onSend?.();
  let result = await solicitarCae(i.env, i.auth, request);
  if (!result.cae && result.errores.some((e) => e.code === 10016)) {
    nro = (await ultimoAutorizado(i.env, i.auth, i.ptoVta, i.tipo)) + 1;
    request = buildRequest(i, nro);
    result = await solicitarCae(i.env, i.auth, request);
  }
  return { approved: result.resultado === "A" && !!result.cae, nro, request, result };
}
