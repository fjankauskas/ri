import { COUNTRIES, type Master } from "../gs1/master";
import type { Raw } from "./client";
// Datos oficiales de GS1 Argentina ya ordenados, y su traducción a los campos de la aplicación.
export type Gs1arLink = { url: string; principal: boolean; digitalLink: string; tipo: string };
export type Gs1arProduct = {
  gtin: string; descripcion: string; marca: string; submarca: string; variedad: string; contenidoNeto: number | null; unidadMedida: string; envase: string;
  segmento: string; familia: string; clase: string; ladrillo: string; codigoInterno: string; paisFabricacion: string;
  razonSocial: string; direccion: string; licencia: string; tipoLicencia: string; glnPrincipal: string; mo: string; website: string; cuit: string; source: string; estado: string;
  mercados: { codigo: string; nombre: string }[]; imagenes: string[]; nroRegSenasa: string; octogonos: string[]; links: Gs1arLink[];
  pack: { gtin14: string; descripcion: string; unidades: number | null; envase: string } | null;
};
const str = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(",", ".")); return v == null || v === "" || Number.isNaN(n) ? null : n; };
export function normalizeProduct(r: Raw): Gs1arProduct {
  const imgs = Array.isArray(r.Imagen) ? r.Imagen : r.Imagen ? [r.Imagen] : [];
  const g14 = str(r.GTIN14);
  return {
    gtin: str(r.GTIN), descripcion: str(r.Descripcion), marca: str(r.Marca), submarca: str(r.SubMarca), variedad: str(r.Variedad), contenidoNeto: num(r.ContenidoNeto), unidadMedida: str(r.UnidadMedida), envase: str(r.Envase),
    segmento: str(r.Segmento), familia: str(r.Familia), clase: str(r.Clase), ladrillo: str(r.Ladrillo), codigoInterno: str(r.CodigoInterno), paisFabricacion: str(r.PaisFabricacion),
    razonSocial: str(r.RazonSocial), direccion: str(r.Direccion), licencia: str(r.Licencia), tipoLicencia: str(r.TipoLicencia), glnPrincipal: str(r.GlnPrincipal), mo: str(r.MO), website: str(r.WebSite), cuit: str(r.CUIT).replace(/\D/g, ""), source: str(r.SOURCE), estado: str(r.ESTADO),
    mercados: (Array.isArray(r.MercadoDestino) ? r.MercadoDestino : []).map((m: Raw) => ({ codigo: str(m.Codigo), nombre: str(m.Nombre) })).filter((m: { codigo: string; nombre: string }) => m.codigo || m.nombre),
    imagenes: imgs.map(str).filter((u: string) => /^https:\/\//i.test(u)), nroRegSenasa: str(r.NroRegSENASA),
    octogonos: (Array.isArray(r.Octogonos) ? r.Octogonos : []).map((o: unknown) => (typeof o === "string" ? o : str((o as Raw)?.Descripcion ?? (o as Raw)?.Nombre ?? JSON.stringify(o)))),
    links: (Array.isArray(r.LinkRegistries) ? r.LinkRegistries : []).map((l: Raw) => ({ url: str(l.linkUrl), principal: /^s/i.test(str(l.LinkPrincipal)), digitalLink: str(l.DigitalLink), tipo: str(l.LinkType) })),
    pack: g14 ? { gtin14: g14, descripcion: str(r.DescripcionGTIN14), unidades: num(r.UnidadesContenidas), envase: str(r.EnvaseGTIN14) } : null,
  };
}

const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
// «(GR) GRAMOS» → código de unidad de la ficha GS1 (UN/CEFACT) y unidad de la aplicación.
const UNITS: Record<string, [string | null, string | null]> = { GR: ["GRM", "g"], G: ["GRM", "g"], GRM: ["GRM", "g"], KG: ["KGM", "kg"], KGM: ["KGM", "kg"], LT: ["LTR", "l"], L: ["LTR", "l"], LTR: ["LTR", "l"], ML: ["MLT", "ml"], MLT: ["MLT", "ml"], UN: ["C62", "u"], U: ["C62", "u"], UNI: ["C62", "u"], C62: ["C62", "u"], MT: ["MTR", "m"], M: ["MTR", "m"], MTR: ["MTR", "m"], CM: ["CMT", null], CMT: ["CMT", null] };
const WORDS: [RegExp, string][] = [[/KILOGRAMO/, "KG"], [/MILILITRO/, "ML"], [/GRAMO/, "GR"], [/LITRO/, "LT"], [/UNIDAD/, "UN"], [/CENTIMETRO/, "CM"], [/METRO/, "MT"]];
export function unitInfo(unidadMedida: string): { master: string | null; unit: string | null } {
  const s = plain(unidadMedida), code = /^\(([A-Z0-9]{1,4})\)/.exec(s)?.[1] ?? "", hit = UNITS[code] ?? (() => { const w = WORDS.find(([re]) => re.test(s)); return w ? UNITS[w[1]] : undefined; })();
  return { master: hit?.[0] ?? null, unit: hit?.[1] ?? null };
}
const ALIAS: Record<string, string> = { "ESTADOS UNIDOS DE AMERICA": "US", EEUU: "US", USA: "US", "REINO UNIDO": "GB", INGLATERRA: "GB", HOLANDA: "NL", "COREA DEL SUR": "KR", "REPUBLICA DE COREA": "KR", "REPUBLICA POPULAR CHINA": "CN" };
export function countryIso(name: string): string | null {
  const n = plain(name).replace(/\(.*\)/, "").trim(); if (!n) return null;
  return ALIAS[n] ?? COUNTRIES.find(([, label]) => plain(label) === n)?.[0] ?? null;
}
/** Nombre sugerido para el producto: descripción + marca + variedad + contenido, sin repetir palabras. */
export function suggestedName(p: Gs1arProduct): string {
  const parts: string[] = [];
  for (const x of [p.descripcion, p.marca, p.submarca, p.variedad]) if (x && !plain(parts.join(" ")).includes(plain(x))) parts.push(x);
  const code = /^\(([A-Z0-9]+)\)/i.exec(p.unidadMedida)?.[1];
  if (p.contenidoNeto != null && code) parts.push(`${p.contenidoNeto} ${code.toLowerCase()}`);
  return parts.join(" ").slice(0, 120);
}
export const unitFor = (p: Gs1arProduct) => unitInfo(p.unidadMedida).unit ?? "u";
const site = (w: string) => (!w ? null : /^https?:\/\//i.test(w) ? w : /^[\w.-]+\.[a-z]{2,}/i.test(w) ? `https://${w}` : null);
/** Datos maestros de la ficha GS1 que se pueden completar con lo que informa GS1 Argentina. */
export function masterFromGs1ar(p: Gs1arProduct): Partial<Master> {
  const u = unitInfo(p.unidadMedida), out: Partial<Master> = {};
  if (p.marca) out.brand = p.marca;
  if (p.contenidoNeto != null && u.master) { out.net_content = p.contenidoNeto; out.net_content_uom = u.master; }
  const iso = countryIso(p.paisFabricacion); if (iso) out.origin_country = iso;
  const w = site(p.website); if (w) out.product_url = w;
  if (p.imagenes[0]) out.image_url = p.imagenes[0];
  const d = [p.descripcion, p.variedad].filter(Boolean).join(" · "); if (d) out.description_long = d;
  return out;
}
/** Combina lo de GS1 con la ficha actual: solo completa los vacíos, salvo que se pida pisar todo. */
export function mergeMaster(current: Partial<Master> | null, incoming: Partial<Master>, overwrite: boolean): { next: Partial<Master>; changed: string[] } {
  const next: Partial<Master> = {}, changed: string[] = [];
  for (const [k, v] of Object.entries(incoming) as [keyof Master, any][]) {
    const cur = current?.[k]; if (v == null || v === "") continue;
    if (overwrite || cur == null || cur === "") { if (cur !== v) { (next as any)[k] = v; changed.push(String(k)); } }
  }
  return { next, changed };
}
