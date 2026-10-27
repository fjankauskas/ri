import { X509Certificate, createPrivateKey } from "node:crypto";
import { createAdmin } from "@/lib/supabase/admin";
import { encryptSecret, decryptSecret } from "./crypto";
import { generateKeyAndCsr, certMatchesKey } from "./csr";
import { cleanCuit, isValidCuit } from "./cuit";
import { getTicket, type TicketStore } from "./ticket";
import { feDummy, ptosVenta, ultimoAutorizado, type Auth } from "./wsfe";
import { creditNoteCore, invoiceSaleCore, type CustomerRow, type ItemRow, type Ports, type Profile, type StoredInvoice, type InvoiceRow } from "./invoicing";
import { pickCbte, cbteNumber, CBTE } from "../billing";
import type { Env } from "./wsaa";

export type { Env };
export const ENVS: Env[] = ["homologacion", "produccion"];
const db = () => createAdmin();
const check = (e: string): Env => { if (e !== "homologacion" && e !== "produccion") throw new Error("Ambiente no válido"); return e; };
const lockMs = 5 * 60 * 1000;

async function safeLog(orgId: string, env: string | null, action: string, ok: boolean, request: unknown, response: unknown, error?: string) {
  try { await db().from("arca_log").insert({ organization_id: orgId, environment: env, action, ok, request: request ?? null, response: response ?? null, error: error ?? null }); } catch { /* el registro nunca debe romper la operación */ }
}

async function getProfile(orgId: string) {
  const { data, error } = await db().from("arca_profile").select("*").eq("organization_id", orgId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as (Profile & { enabled: boolean; active_env: Env }) | null;
}
async function creds(orgId: string, env: Env) {
  const profile = await getProfile(orgId);
  if (!profile) throw new Error("Primero cargá los datos fiscales de la empresa en «Facturación ARCA».");
  const { data: acc } = await db().from("arca_accounts").select("*").eq("organization_id", orgId).eq("environment", env).maybeSingle();
  if (!acc?.cert_pem) throw new Error(`Falta el certificado de ARCA para el ambiente de ${env === "produccion" ? "producción" : "homologación"}.`);
  if (!acc.punto_venta) throw new Error("Falta indicar el punto de venta.");
  if (acc.cert_valid_to && new Date(acc.cert_valid_to) < new Date()) throw new Error("El certificado de ARCA está vencido. Generá uno nuevo.");
  const { data: k } = await db().from("arca_keys").select("key_encrypted").eq("organization_id", orgId).eq("environment", env).maybeSingle();
  if (!k) throw new Error("No hay clave privada guardada para este ambiente. Generá la solicitud de certificado de nuevo.");
  return { profile, ptoVta: Number(acc.punto_venta), certPem: acc.cert_pem as string, keyPem: decryptSecret(k.key_encrypted) };
}
const store = (orgId: string, env: Env): TicketStore => ({
  load: async () => {
    const { data } = await db().from("arca_tokens").select("token, sign, expires_at").eq("organization_id", orgId).eq("environment", env).eq("service", "wsfe").maybeSingle();
    return data ? { token: data.token, sign: data.sign, expiresAt: new Date(data.expires_at) } : null;
  },
  save: async (t) => { await db().from("arca_tokens").upsert({ organization_id: orgId, environment: env, service: "wsfe", token: t.token, sign: t.sign, expires_at: t.expiresAt.toISOString() }); },
});
const authOf = async (orgId: string, env: Env, c: { profile: Profile; certPem: string; keyPem: string }): Promise<Auth> => {
  const t = await getTicket(env, c.certPem, c.keyPem, store(orgId, env));
  return { token: t.token, sign: t.sign, cuit: cleanCuit(c.profile.cuit) };
};

// ---------- Configuración ----------
export async function saveProfile(orgId: string, i: { cuit: string; legal_name: string; iva_condition: string; address: string; gross_income: string; activity_start: string; active_env: string; enabled: boolean }) {
  const cuit = cleanCuit(i.cuit);
  if (!isValidCuit(cuit)) throw new Error("El CUIT no es válido (revisá los 11 dígitos).");
  if (!i.legal_name.trim()) throw new Error("Indicá la razón social.");
  if (!["RI", "MONO", "EXENTO"].includes(i.iva_condition)) throw new Error("Elegí la condición frente al IVA.");
  const env = check(i.active_env), prev = await getProfile(orgId);
  let note = "";
  if (prev && cleanCuit(prev.cuit) !== cuit) {   // los certificados pertenecen a un CUIT: si cambia, se invalidan
    await db().from("arca_keys").delete().eq("organization_id", orgId);
    await db().from("arca_tokens").delete().eq("organization_id", orgId);
    await db().from("arca_accounts").update({ csr_pem: null, cert_pem: null, cert_valid_to: null, last_test_at: null, last_test_ok: null, last_test_message: null }).eq("organization_id", orgId);
    note = " Cambiaste el CUIT: hay que generar de nuevo los certificados.";
  }
  const { error } = await db().from("arca_profile").upsert({ organization_id: orgId, cuit, legal_name: i.legal_name.trim(), iva_condition: i.iva_condition, address: i.address.trim() || null, gross_income: i.gross_income.trim() || null, activity_start: i.activity_start || null, active_env: env, enabled: i.enabled, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return note;
}
export async function savePuntoVenta(orgId: string, envIn: string, pv: number) {
  const env = check(envIn);
  if (!Number.isInteger(pv) || pv < 1 || pv > 99998) throw new Error("El punto de venta debe ser un número entre 1 y 99998.");
  const { error } = await db().from("arca_accounts").upsert({ organization_id: orgId, environment: env, punto_venta: pv });
  if (error) throw new Error(error.message);
}
export async function createCsr(orgId: string, envIn: string) {
  const env = check(envIn), profile = await getProfile(orgId);
  if (!profile) throw new Error("Primero cargá los datos fiscales de la empresa.");
  const { privateKeyPem, csrPem } = generateKeyAndCsr({ cuit: profile.cuit, org: profile.legal_name, alias: `red-inventario-${env === "produccion" ? "prod" : "homo"}` });
  const k = await db().from("arca_keys").upsert({ organization_id: orgId, environment: env, key_encrypted: encryptSecret(privateKeyPem), created_at: new Date().toISOString() });
  if (k.error) throw new Error(k.error.message);
  await db().from("arca_accounts").upsert({ organization_id: orgId, environment: env, csr_pem: csrPem, cert_pem: null, cert_valid_to: null, last_test_at: null, last_test_ok: null, last_test_message: null });
  await db().from("arca_tokens").delete().eq("organization_id", orgId).eq("environment", env);
  await safeLog(orgId, env, "CSR generado", true, null, null);
}
function parseCert(pem: string, profile: Profile): X509Certificate {
  let cert: X509Certificate;
  try { cert = new X509Certificate(pem); } catch { throw new Error("El certificado no es válido: pegá el contenido completo del archivo .crt (empieza con -----BEGIN CERTIFICATE-----)."); }
  if (new Date(cert.validTo) < new Date()) throw new Error("El certificado ya está vencido.");
  const inCert = /CUIT\s*(\d{11})/i.exec(cert.subject)?.[1];
  if (inCert && inCert !== cleanCuit(profile.cuit)) throw new Error(`El certificado es del CUIT ${inCert}, no del CUIT de la empresa (${cleanCuit(profile.cuit)}).`);
  return cert;
}
export async function saveCertificate(orgId: string, envIn: string, certPem: string) {
  const env = check(envIn), profile = await getProfile(orgId);
  if (!profile) throw new Error("Primero cargá los datos fiscales de la empresa.");
  const { data: k } = await db().from("arca_keys").select("key_encrypted").eq("organization_id", orgId).eq("environment", env).maybeSingle();
  if (!k) throw new Error("Primero generá la clave y la solicitud (CSR): el certificado de ARCA se emite para esa clave.");
  const cert = parseCert(certPem, profile);
  if (!certMatchesKey(certPem, decryptSecret(k.key_encrypted))) throw new Error("Ese certificado no corresponde a la clave generada en este ambiente. ¿Usaste el CSR de otro ambiente o uno anterior?");
  await db().from("arca_accounts").upsert({ organization_id: orgId, environment: env, cert_pem: certPem.trim() + "\n", cert_valid_to: new Date(cert.validTo).toISOString() });
  await db().from("arca_tokens").delete().eq("organization_id", orgId).eq("environment", env);
  await safeLog(orgId, env, "Certificado guardado", true, null, null);
}
export async function importCredentials(orgId: string, envIn: string, keyPem: string, certPem: string) {
  const env = check(envIn), profile = await getProfile(orgId);
  if (!profile) throw new Error("Primero cargá los datos fiscales de la empresa.");
  try { createPrivateKey(keyPem); } catch { throw new Error("La clave privada no es válida o está protegida con contraseña (exportala sin contraseña)."); }
  const cert = parseCert(certPem, profile);
  if (!certMatchesKey(certPem, keyPem)) throw new Error("El certificado no corresponde a esa clave privada.");
  const k = await db().from("arca_keys").upsert({ organization_id: orgId, environment: env, key_encrypted: encryptSecret(keyPem.trim() + "\n"), created_at: new Date().toISOString() });
  if (k.error) throw new Error(k.error.message);
  await db().from("arca_accounts").upsert({ organization_id: orgId, environment: env, csr_pem: null, cert_pem: certPem.trim() + "\n", cert_valid_to: new Date(cert.validTo).toISOString() });
  await db().from("arca_tokens").delete().eq("organization_id", orgId).eq("environment", env);
  await safeLog(orgId, env, "Credenciales importadas", true, null, null);
}

/** Autentica contra WSAA, consulta el estado del servicio y el último comprobante: verifica de punta a punta que todo esté bien configurado. */
export async function testConnection(orgId: string, envIn: string): Promise<{ ok: boolean; message: string }> {
  const env = check(envIn); let result: { ok: boolean; message: string };
  try {
    const c = await creds(orgId, env), auth = await authOf(orgId, env, c), tk = await store(orgId, env).load();
    const d = await feDummy(env);
    if (d.app !== "OK" || d.db !== "OK" || d.auth !== "OK") throw new Error(`Los servidores de ARCA informan problemas (app ${d.app}, base ${d.db}, autenticación ${d.auth}). Probá más tarde.`);
    let warn = "", note = "";
    try {
      const pts = await ptosVenta(env, auth), mine = pts.find((p) => p.nro === c.ptoVta), prod = env === "produccion";
      if (!pts.length) { if (prod) warn = " Atención: ARCA no lista puntos de venta habilitados para web services en producción: creá uno en «Administración de puntos de venta y domicilios»."; else note = " ARCA no lista puntos de venta en homologación: es normal, en pruebas se puede usar cualquier número de punto de venta sin registrarlo."; }
      else if (!mine) { const t = ` el punto de venta ${c.ptoVta} no figura entre los habilitados (${pts.map((p) => p.nro).join(", ")}).`; if (prod) warn = " Atención:" + t; else note = " Aviso:" + t; }
      else if (mine.bloqueado) warn = ` Atención: el punto de venta ${c.ptoVta} está bloqueado.`;
    } catch { /* el listado de puntos de venta es informativo */ }
    const { tipo } = pickCbte(c.profile.iva_condition, 5, "INVOICE");
    const last = await ultimoAutorizado(env, auth, c.ptoVta, tipo);
    result = { ok: !warn, message: `Conexión correcta con ARCA (${env === "produccion" ? "producción" : "homologación"}). Autenticación válida hasta ${tk ? tk.expiresAt.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "—"}. Último ${CBTE[tipo]} autorizado en el punto de venta ${c.ptoVta}: ${last ? cbteNumber(c.ptoVta, last) : "ninguno todavía"}.${warn}${note}` };
  } catch (e: any) { result = { ok: false, message: String(e.message) }; }
  await db().from("arca_accounts").upsert({ organization_id: orgId, environment: env, last_test_at: new Date().toISOString(), last_test_ok: result.ok, last_test_message: result.message });
  await safeLog(orgId, env, "Prueba de conexión", result.ok, null, null, result.ok ? undefined : result.message);
  return result;
}

// ---------- Emisión ----------
export async function invoiceSale(orgId: string, saleId: string, userId: string) {
  const profile = await getProfile(orgId);
  if (!profile?.enabled) throw new Error("La facturación electrónica no está activada. Activala en «Facturación ARCA».");
  const env = profile.active_env, c = await creds(orgId, env);
  const { data: sale } = await db().from("sales").select("id, customer_id").eq("id", saleId).eq("organization_id", orgId).maybeSingle();
  if (!sale) throw new Error("No se encontró la venta.");
  const { data: items } = await db().from("sale_items").select("description, qty, unit_price, iva").eq("sale_id", saleId).eq("organization_id", orgId).order("id");
  let customer: CustomerRow = null;
  if (sale.customer_id) { const { data } = await db().from("customers").select("name, doc_type, doc_number, iva_condition").eq("id", sale.customer_id).eq("organization_id", orgId).maybeSingle(); customer = data; }
  const upd = (patch: Record<string, unknown>) => db().from("sales").update(patch).eq("id", saleId).eq("organization_id", orgId);
  const ports: Ports = {
    claim: async () => {
      const cutoff = new Date(Date.now() - lockMs).toISOString();
      const { data } = await upd({ invoice_state: "PROCESSING", processing_at: new Date().toISOString(), invoice_error: null }).or(`invoice_state.eq.NONE,and(invoice_state.eq.PROCESSING,processing_at.lt.${cutoff})`).select("id");
      return !!data?.length;
    },
    release: async (error, keep) => { await upd(keep ? { invoice_error: error } : { invoice_state: "NONE", invoice_error: error }); },
    saveInvoice: async (row: InvoiceRow) => { const { data, error } = await db().from("invoices").insert(row).select("id").single(); if (error) throw new Error(error.message); return data.id as string; },
    markDone: async () => { await upd({ invoice_state: "INVOICED", invoice_error: null }); },
    log: (a, ok, req, res, err) => safeLog(orgId, env, a, ok, req, res, err),
    getAuth: () => authOf(orgId, env, c),
  };
  return invoiceSaleCore({ env, profile, ptoVta: c.ptoVta, orgId, saleId, userId, items: (items ?? []) as ItemRow[], customer, ports });
}

export async function issueCreditNote(orgId: string, invoiceId: string, userId: string) {
  const profile = await getProfile(orgId);
  if (!profile?.enabled) throw new Error("La facturación electrónica no está activada.");
  const { data: inv } = await db().from("invoices").select("*").eq("id", invoiceId).eq("organization_id", orgId).maybeSingle();
  if (!inv) throw new Error("No se encontró el comprobante.");
  if (inv.kind !== "INVOICE") throw new Error("Solo se puede anular una factura (no una nota de crédito).");
  const { data: existing } = await db().from("invoices").select("id").eq("related_invoice_id", invoiceId).maybeSingle();
  if (existing) throw new Error("Esta factura ya tiene una nota de crédito.");
  const env = check(inv.environment), c = await creds(orgId, env);
  const upd = (patch: Record<string, unknown>) => db().from("invoices").update(patch).eq("id", invoiceId).eq("organization_id", orgId);
  const ports: Ports = {
    claim: async () => { const cutoff = new Date(Date.now() - lockMs).toISOString(); const { data } = await upd({ credit_lock_at: new Date().toISOString() }).or(`credit_lock_at.is.null,credit_lock_at.lt.${cutoff}`).select("id"); return !!data?.length; },
    release: async (_e, keep) => { if (!keep) await upd({ credit_lock_at: null }); },
    saveInvoice: async (row: InvoiceRow) => { const { data, error } = await db().from("invoices").insert(row).select("id").single(); if (error) throw new Error(error.message); return data.id as string; },
    markDone: async () => {},
    log: (a, ok, req, res, err) => safeLog(orgId, env, a, ok, req, res, err),
    getAuth: () => authOf(orgId, env, c),
  };
  return creditNoteCore({ env, profile, ptoVta: inv.pto_vta, orgId, saleId: inv.sale_id, userId, invoice: inv as StoredInvoice, ports });
}
