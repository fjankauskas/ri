import { signCms } from "./cms";
import { soapPost } from "./http";
import { esc, tag, text, unesc } from "./xml";

export type Env = "homologacion" | "produccion";
export const WSAA_URL: Record<Env, string> = {
  homologacion: process.env.ARCA_WSAA_URL_HOMO || "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: process.env.ARCA_WSAA_URL_PROD || "https://wsaa.afip.gov.ar/ws/services/LoginCms",
};
export type Ticket = { token: string; sign: string; expiresAt: Date };

// Argentina es UTC-3 todo el año: así el TRA siempre lleva la hora local pedida por el manual (GMT-3).
export const arTime = (d: Date) => new Date(d.getTime() - 3 * 3600 * 1000).toISOString().replace("Z", "-03:00");

/** Ticket de Requerimiento de Acceso (sin source/destination, como recomienda el manual). */
export function buildTra(service: string, now = new Date()): string {
  const gen = new Date(now.getTime() - 10 * 60 * 1000), exp = new Date(now.getTime() + 10 * 60 * 1000);
  return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId><generationTime>${arTime(gen)}</generationTime><expirationTime>${arTime(exp)}</expirationTime></header><service>${esc(service)}</service></loginTicketRequest>`;
}
export const loginEnvelope = (cmsB64: string) =>
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsB64}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;

export function parseLogin(body: string): Ticket {
  const fault = text(body, "faultstring");
  const ret = tag(body, "loginCmsReturn");
  if (!ret) throw new Error(`WSAA rechazó la solicitud: ${fault ?? "respuesta inesperada"}`);
  const ta = unesc(ret);
  const token = text(ta, "token"), sign = text(ta, "sign"), exp = text(ta, "expirationTime");
  if (!token || !sign || !exp) throw new Error("WSAA devolvió un ticket incompleto");
  return { token, sign, expiresAt: new Date(exp) };
}

/** Pide un ticket de acceso (válido ~12 h) para el servicio indicado, firmado con el certificado de la empresa. */
export async function login(env: Env, certPem: string, keyPem: string, service = "wsfe"): Promise<Ticket> {
  const cms = signCms(buildTra(service), certPem, keyPem);
  const res = await soapPost(WSAA_URL[env], loginEnvelope(cms), "urn:LoginCms");
  return parseLogin(res.body);
}
