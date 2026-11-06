"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/ctx";
import { mustCan } from "@/lib/perms-server";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const clean = (e: any) => String(e?.message ?? "Error inesperado").replace(/^[A-Z_]+: /, "");
const back = (f: FormData, def: string) => (/^\/(commerce|network)(\?[\w=&%.|\-]*)?$/.test(s(f, "back")) ? s(f, "back") : def);
const withParam = (path: string, k: string, v: string) => `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
const view = (kind: string) => (kind === "supplier" ? "suppliers" : "customers");
/** Dirección pública de la app para armar enlaces de invitación que se puedan compartir. */
async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers(), host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000", proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Conecta con una empresa encontrada en la red y la agrega como cliente o proveedor. */
export async function addFromNetwork(f: FormData) {
  const { sb, org } = await ctx(); const kind = s(f, "kind") === "supplier" ? "supplier" : "customer", path = `/commerce?v=${view(kind)}`; let err = "", id = "";
  try {
    await mustCan("network", "create"); await mustCan(kind === "customer" ? "sales" : "purchases", "create");
    const { data, error } = await sb.rpc("add_partner_from_network", { p_org: org.id, p_target: s(f, "org"), p_kind: kind, p_iva: Number(s(f, "iva") || 1) });
    if (error) throw new Error(error.message); id = String(data);
  } catch (e: any) { err = clean(e); }
  revalidatePath("/", "layout");
  redirect(err ? withParam(back(f, path), "e", err) : withParam(`${path}&id=${id}`, "ok", `Listo: la empresa quedó cargada como ${kind === "customer" ? "cliente" : "proveedor"} y le enviamos la solicitud de conexión.`));
}

/** Invita a una empresa que no usa la app: la carga en tu lista y devuelve el enlace para mandárselo por email o WhatsApp. */
export async function inviteCompany(f: FormData) {
  const { sb, org } = await ctx(); const kind = s(f, "kind") === "supplier" ? "supplier" : "customer", path = `/commerce?v=${view(kind)}&modal=${kind}`; let err = "", token = "";
  try {
    await mustCan("network", "create"); await mustCan(kind === "customer" ? "sales" : "purchases", "create");
    const { data, error } = await sb.rpc("invite_company", { p_org: org.id, p_kind: kind, p_name: s(f, "name"), p_email: s(f, "email") || null, p_phone: s(f, "phone") || null, p_tax_id: s(f, "cuit") || null, p_iva: Number(s(f, "iva") || 1) });
    if (error) throw new Error(error.message); token = String(data);
  } catch (e: any) { err = clean(e); }
  revalidatePath("/", "layout");
  if (err) redirect(withParam(`${path}&mode=invite`, "e", err));
  const link = `${await siteUrl()}/login?invite=${token}`;
  redirect(`${path}&mode=invited&n=${encodeURIComponent(s(f, "name"))}&em=${encodeURIComponent(s(f, "email"))}&ph=${encodeURIComponent(s(f, "phone"))}&lk=${encodeURIComponent(link)}`);
}

/** Cómo te pueden encontrar otras empresas: email y teléfono de contacto (el CUIT siempre sirve para buscarte). */
export async function saveNetworkProfile(f: FormData) {
  const { sb, org } = await ctx(); let err = "";
  try {
    await mustCan("network", "edit");
    const { error } = await sb.from("network_profile").upsert({ organization_id: org.id, contact_email: s(f, "contact_email") || null, contact_phone: s(f, "contact_phone") || null, searchable: !!f.get("searchable"), updated_at: new Date().toISOString() });
    if (error) throw new Error(/network_profile_contact/.test(error.message) ? "El email o el teléfono no tienen un formato válido." : error.message);
  } catch (e: any) { err = clean(e); }
  revalidatePath("/", "layout");
  redirect(withParam(back(f, "/network?v=partners"), err ? "e" : "ok", err || "Perfil en la red guardado"));
}
