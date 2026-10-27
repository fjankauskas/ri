import QRCode from "qrcode";
import { ean13, ean8, upca, itf14, gs1_128, code128, toSvg, type SvgOptions } from "./barcode";
import { buildElementString, parseElementString } from "./ai";
import { toDigitalLink } from "./digitallink";

export type Symbology = "ean13" | "ean8" | "upca" | "itf14" | "code128" | "gs1-128" | "gs1dl-qr" | "gs1datamatrix" | "gs1qrcode" | "databaromni" | "databarlimited" | "databarexpanded" | "databarstacked";
/** `input`: «key» = solo dígitos de la clave; «gs1» = cadena de elementos con AI entre paréntesis; «text» = texto libre. */
export const SYMBOLOGIES: { key: Symbology; label: string; input: "key" | "gs1" | "text"; use: string }[] = [
  { key: "ean13", label: "EAN-13 (GTIN-13)", input: "key", use: "Punto de venta: unidades de consumo" },
  { key: "ean8", label: "EAN-8 (GTIN-8)", input: "key", use: "Punto de venta: envases muy pequeños" },
  { key: "upca", label: "UPC-A (GTIN-12)", input: "key", use: "Punto de venta: mercado de EE. UU. y Canadá" },
  { key: "itf14", label: "ITF-14 (GTIN-14)", input: "key", use: "Cajas y bultos corrugados" },
  { key: "gs1-128", label: "GS1-128", input: "gs1", use: "Logística: lote, vencimiento, serie, SSCC, cantidad" },
  { key: "gs1datamatrix", label: "GS1 DataMatrix", input: "gs1", use: "Productos pequeños y salud: GTIN + lote + vencimiento + serie" },
  { key: "gs1qrcode", label: "GS1 QR Code", input: "gs1", use: "Datos GS1 en un QR (aplicaciones cerradas)" },
  { key: "gs1dl-qr", label: "QR con GS1 Digital Link", input: "gs1", use: "Consumidores: el QR abre una URL con el GTIN, lote y vencimiento" },
  { key: "databaromni", label: "GS1 DataBar Omnidireccional", input: "gs1", use: "Frutas, verduras y artículos pequeños (solo GTIN)" },
  { key: "databarlimited", label: "GS1 DataBar Limitado", input: "gs1", use: "Artículos pequeños (GTIN con indicador 0 o 1)" },
  { key: "databarexpanded", label: "GS1 DataBar Expandido", input: "gs1", use: "Peso variable, vencimiento, cupones" },
  { key: "databarstacked", label: "GS1 DataBar Apilado", input: "gs1", use: "Frutas, verduras y artículos pequeños (apilado)" },
  { key: "code128", label: "Code 128", input: "text", use: "Uso interno (no es un código GS1)" },
];
const BWIP: Partial<Record<Symbology, string>> = { gs1datamatrix: "gs1datamatrix", gs1qrcode: "gs1qrcode", databaromni: "databaromni", databarlimited: "databarlimited", databarexpanded: "databarexpanded", databarstacked: "databarstackedomni" };

export type Rendered = { svg: string; hri: string; link?: string };
/** Genera el símbolo en SVG. Lineales: codificadores propios (verificados con un lector); DataMatrix/DataBar/QR GS1: bwip-js; QR de Digital Link: qrcode. */
export async function renderSymbol(type: Symbology, data: string, o: SvgOptions & { module?: number } = {}): Promise<Rendered> {
  const def = SYMBOLOGIES.find((s) => s.key === type); if (!def) throw new Error("Simbología no soportada");
  const d = data.trim(); if (!d) throw new Error("Ingresá los datos del código");
  if (def.input === "key") {
    const clean = d.replace(/[\s-]/g, "");
    const b = type === "ean13" ? ean13(clean) : type === "ean8" ? ean8(clean) : type === "upca" ? upca(clean) : itf14(clean);
    return { svg: toSvg(b, o), hri: b.hri };
  }
  if (def.input === "text") return { svg: toSvg(code128(d), o), hri: d };
  const p = parseElementString(d);
  if (!p.ok) throw new Error(p.errors[0] ?? "Los datos GS1 no son válidos");
  const items = p.elements.map((e) => ({ ai: e.ai, value: e.value })), hri = buildElementString(items, "hri");
  if (type === "gs1-128") return { svg: toSvg(gs1_128(buildElementString(items, "raw"), hri), o), hri };
  if (type === "gs1dl-qr") {
    const dl = toDigitalLink(items); if (dl.errors.length) throw new Error(dl.errors[0]);
    return { svg: await QRCode.toString(dl.url, { type: "svg", margin: 2, errorCorrectionLevel: "M" }), hri: dl.url, link: dl.url };
  }
  let mod: any;
  try { mod = await import("bwip-js"); } catch { throw new Error("Falta la biblioteca bwip-js: ejecutá «npm install» en la carpeta del proyecto."); }
  const lib = mod.default ?? mod;
  if (typeof lib.toSVG !== "function") throw new Error("La versión instalada de bwip-js no incluye toSVG: actualizala con «npm install bwip-js@latest».");
  const svg: string = lib.toSVG({ bcid: BWIP[type], text: hri, scale: o.module ?? 3, includetext: type.startsWith("databar"), textxalign: "center", paddingwidth: 8, paddingheight: 8 });
  return { svg, hri };
}
