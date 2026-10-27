import { soapPost } from "./http";
import { all, esc, tag, text } from "./xml";
import type { Env } from "./wsaa";

export const WSFE_URL: Record<Env, string> = {
  homologacion: process.env.ARCA_WSFE_URL_HOMO || "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: process.env.ARCA_WSFE_URL_PROD || "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};
const NS = "http://ar.gov.afip.dif.FEV1/";
export type Auth = { token: string; sign: string; cuit: string };
export type Msg = { code: number; msg: string };
const envelope = (body: string) => `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}"><soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
const authXml = (a: Auth) => `<ar:Auth><ar:Token>${esc(a.token)}</ar:Token><ar:Sign>${esc(a.sign)}</ar:Sign><ar:Cuit>${a.cuit}</ar:Cuit></ar:Auth>`;
const call = (env: Env, op: string, inner: string) => soapPost(WSFE_URL[env], envelope(`<ar:${op}>${inner}</ar:${op}>`), `${NS}${op}`);
const msgs = (xml: string, wrap: string, item: string): Msg[] => all(tag(xml, wrap) ?? "", item).map((x) => ({ code: Number(text(x, "Code")), msg: text(x, "Msg") ?? "" }));
export const parseErrors = (xml: string) => msgs(xml, "Errors", "Err");
export const errText = (e: Msg[]) => e.map((x) => `(${x.code}) ${x.msg}`).join(" · ");
function assertOk(res: { status: number; body: string }, op: string) {
  if (!tag(res.body, `${op}Result`)) throw new Error(`ARCA respondió un error en ${op}: ${text(res.body, "faultstring") ?? `HTTP ${res.status}`}`);
}

export async function feDummy(env: Env) {
  const res = await call(env, "FEDummy", ""); assertOk(res, "FEDummy");
  return { app: text(res.body, "AppServer"), db: text(res.body, "DbServer"), auth: text(res.body, "AuthServer") };
}
export async function ultimoAutorizado(env: Env, auth: Auth, ptoVta: number, tipo: number): Promise<number> {
  const res = await call(env, "FECompUltimoAutorizado", `${authXml(auth)}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo>`);
  assertOk(res, "FECompUltimoAutorizado");
  const err = parseErrors(res.body); if (err.length) throw new Error(`ARCA: ${errText(err)}`);
  return Number(text(res.body, "CbteNro") ?? 0);
}
export async function ptosVenta(env: Env, auth: Auth) {
  const res = await call(env, "FEParamGetPtosVenta", authXml(auth)); assertOk(res, "FEParamGetPtosVenta");
  const err = parseErrors(res.body);
  if (err.some((e) => e.code === 602)) return [];   // 602 «Sin resultados»: el CUIT no tiene puntos de venta para web services
  if (err.length) throw new Error(`ARCA: ${errText(err)}`);
  return all(res.body, "PtoVenta").map((x) => ({ nro: Number(text(x, "Nro")), tipo: text(x, "EmisionTipo") ?? "", bloqueado: text(x, "Bloqueado") === "S" }));
}

export type CaeRequest = {
  ptoVta: number; tipo: number; nro: number; concepto: number; docTipo: number; docNro: string; fecha: string; // fecha yyyymmdd
  total: number; totConc: number; neto: number; opEx: number; trib: number; iva: number; monId: string; monCotiz: number; condIvaReceptor: number;
  alic: { id: number; base: number; importe: number }[]; asoc?: { tipo: number; ptoVta: number; nro: number; cuit: string; fecha: string };
};
const m = (n: number) => n.toFixed(2);
/** Cuerpo de FECAESolicitar. El orden de los elementos es el del esquema del WSFEv1 (manual v4.7). */
export function caeSolicitarBody(auth: Auth, r: CaeRequest): string {
  const iva = r.alic.length ? `<ar:Iva>${r.alic.map((a) => `<ar:AlicIva><ar:Id>${a.id}</ar:Id><ar:BaseImp>${m(a.base)}</ar:BaseImp><ar:Importe>${m(a.importe)}</ar:Importe></ar:AlicIva>`).join("")}</ar:Iva>` : "";
  const asoc = r.asoc ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${r.asoc.tipo}</ar:Tipo><ar:PtoVta>${r.asoc.ptoVta}</ar:PtoVta><ar:Nro>${r.asoc.nro}</ar:Nro><ar:Cuit>${r.asoc.cuit}</ar:Cuit><ar:CbteFch>${r.asoc.fecha}</ar:CbteFch></ar:CbteAsoc></ar:CbtesAsoc>` : "";
  return `${authXml(auth)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${r.ptoVta}</ar:PtoVta><ar:CbteTipo>${r.tipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>`
    + `<ar:Concepto>${r.concepto}</ar:Concepto><ar:DocTipo>${r.docTipo}</ar:DocTipo><ar:DocNro>${r.docNro}</ar:DocNro><ar:CbteDesde>${r.nro}</ar:CbteDesde><ar:CbteHasta>${r.nro}</ar:CbteHasta><ar:CbteFch>${r.fecha}</ar:CbteFch>`
    + `<ar:ImpTotal>${m(r.total)}</ar:ImpTotal><ar:ImpTotConc>${m(r.totConc)}</ar:ImpTotConc><ar:ImpNeto>${m(r.neto)}</ar:ImpNeto><ar:ImpOpEx>${m(r.opEx)}</ar:ImpOpEx><ar:ImpTrib>${m(r.trib)}</ar:ImpTrib><ar:ImpIVA>${m(r.iva)}</ar:ImpIVA>`
    + `<ar:MonId>${r.monId}</ar:MonId><ar:MonCotiz>${r.monCotiz}</ar:MonCotiz><ar:CondicionIVAReceptorId>${r.condIvaReceptor}</ar:CondicionIVAReceptorId>${asoc}${iva}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`;
}

export type CaeResult = { resultado: string; cae: string | null; caeVto: string | null; nro: number | null; observaciones: Msg[]; errores: Msg[]; eventos: Msg[] };
const isoDate = (s: string | null) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
export function parseCae(body: string): CaeResult {
  const det = tag(body, "FECAEDetResponse") ?? tag(body, "FEDetResponse") ?? "";
  const cae = text(det, "CAE");
  return {
    resultado: text(det, "Resultado") ?? text(tag(body, "FeCabResp") ?? "", "Resultado") ?? "R",
    cae: cae && cae.trim() ? cae.trim() : null,
    caeVto: isoDate(text(det, "CAEFchVto")),
    nro: det ? Number(text(det, "CbteDesde")) || null : null,
    observaciones: all(det, "Obs").map((x) => ({ code: Number(text(x, "Code")), msg: text(x, "Msg") ?? "" })),
    errores: parseErrors(body), eventos: msgs(body, "Events", "Evt"),
  };
}
export async function solicitarCae(env: Env, auth: Auth, r: CaeRequest): Promise<CaeResult> {
  const res = await call(env, "FECAESolicitar", caeSolicitarBody(auth, r)); assertOk(res, "FECAESolicitar");
  return parseCae(res.body);
}
