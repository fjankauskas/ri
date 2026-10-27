import { validateGtin, toGtin14 } from "./check";
import { parseElementString, buildElementString, type Element } from "./ai";
import { fromDigitalLink } from "./digitallink";
import { gtin13, internalGtin13 } from "./keys";
import { type EpcisRow } from "./epcis";
// Acceso a datos GS1 (servidor). Todas las consultas usan el cliente del usuario: rige la seguridad por empresa (RLS).
export type Settings = { company_prefix: string | null; gln: string | null; public_enabled: boolean };
export async function getSettings(sb: any, orgId: string): Promise<Settings> {
  const { data } = await sb.from("gs1_settings").select("company_prefix, gln, public_enabled").eq("organization_id", orgId).maybeSingle();
  return { company_prefix: data?.company_prefix ?? null, gln: data?.gln ?? null, public_enabled: !!data?.public_enabled };
}
/** Formas equivalentes de escribir un mismo GTIN (8, 12, 13 o 14 dígitos con ceros a la izquierda). */
export function gtinVariants(code: string): string[] {
  const g = toGtin14(code.replace(/\D/g, "")), out = new Set([g, g.slice(1), g.slice(2)]);
  if (g.startsWith("000000")) out.add(g.slice(6));
  return [...out];
}
/** ¿Ya existe ese GTIN en la empresa, como unidad de otro producto o como presentación? */
export async function gtinTaken(sb: any, orgId: string, gtin: string, exceptProduct?: string): Promise<boolean> {
  const v = gtinVariants(gtin);
  const [a, b] = await Promise.all([
    sb.from("products").select("id").eq("organization_id", orgId).eq("is_active", true).in("gtin", v),
    sb.from("product_gtins").select("id, product_id").eq("organization_id", orgId).in("gtin", v),
  ]);
  return ((a.data ?? []) as any[]).some((r) => r.id !== exceptProduct) || ((b.data ?? []) as any[]).length > 0;
}
/** Próximo GTIN libre: GTIN-13 de la empresa (prefijo + correlativo) o código interno de distribución restringida. */
export async function allocateGtin(sb: any, orgId: string, mode: "gs1" | "internal"): Promise<string> {
  const s = await getSettings(sb, orgId);
  if (mode === "gs1" && !s.company_prefix) throw new Error("Primero cargá el prefijo de empresa GS1 en «Configuración».");
  for (let i = 0; i < 60; i++) {
    const { data: n, error } = await sb.rpc("gs1_next", { p_org: orgId, p_kind: mode === "gs1" ? "GTIN" : "INTERNAL" });
    if (error) throw new Error(error.message.replace(/^[A-Z_]+: /, ""));
    const g = mode === "gs1" ? gtin13(s.company_prefix!, Number(n)) : internalGtin13(Number(n));
    if (!(await gtinTaken(sb, orgId, g))) return g;
  }
  throw new Error("No se encontró un GTIN libre: revisá el prefijo y los GTIN ya cargados.");
}

export type Resolved = {
  input: string; kind: "gtin" | "elements" | "digitallink" | "invalid"; symbology?: string; elements: Element[]; errors: string[]; ok: boolean; hri?: string;
  product?: { id: string; name: string; sku: string; unit: string; gtin: string | null; price: number | null; price_per: number | null; iva: string };
  level?: string; unitsPerPack?: number;
  lot?: { id: string; lot_number: string; expiration_date: string | null; qty: number };
  stock?: { total: number; available: number };
  shipment?: { id: string; sscc: string };
};
/** Interpreta lo que se escaneó o pegó (GTIN, cadena GS1 o Digital Link) y lo relaciona con productos, lotes, stock y envíos de la empresa. */
export async function resolveCode(sb: any, orgId: string, input: string): Promise<Resolved> {
  const raw = input.trim(); const base: Resolved = { input: raw, kind: "invalid", elements: [], errors: [], ok: false };
  if (!raw) return { ...base, errors: ["Ingresá o escaneá un código"] };
  let kind: Resolved["kind"], elements: Element[], errors: string[], symbology: string | undefined;
  if (/^https?:\/\//i.test(raw)) { const d = fromDigitalLink(raw); kind = "digitallink"; elements = d.elements; errors = d.errors; }
  else if (/^\d{8,14}$/.test(raw)) { const g = validateGtin(raw); kind = "gtin"; const p = parseElementString(`(01)${toGtin14(raw)}`); elements = p.elements; errors = g.ok ? [] : [g.error!]; }
  else { const p = parseElementString(raw); kind = "elements"; elements = p.elements; errors = p.errors; symbology = p.symbology; }
  const out: Resolved = { input: raw, kind, symbology, elements, errors, ok: !errors.length && elements.length > 0, hri: elements.length ? buildElementString(elements.map((e) => ({ ai: e.ai, value: e.value }))) : undefined };
  const val = (ai: string) => elements.find((e) => e.ai === ai)?.value;
  const gtin = val("01") ?? val("02");
  if (gtin && validateGtin(gtin).ok) {
    const v = gtinVariants(gtin);
    const { data: p } = await sb.from("products").select("id, name, sku, unit, gtin, price, price_per, iva").eq("organization_id", orgId).eq("is_active", true).in("gtin", v).limit(1);
    let prod = (p as any[])?.[0];
    if (!prod) {
      const { data: k } = await sb.from("product_gtins").select("level, units_per_pack, products(id, name, sku, unit, gtin, price, price_per, iva, is_active)").eq("organization_id", orgId).in("gtin", v).limit(1);
      const row = (k as any[])?.[0]; if (row?.products?.is_active) { prod = row.products; out.level = row.level; out.unitsPerPack = Number(row.units_per_pack); }
    } else out.level = "UNIT";
    if (prod) {
      out.product = prod;
      const [{ data: pos }, lotRes] = await Promise.all([
        sb.from("inventory_positions").select("quantity, reserved, lot_id").eq("product_id", prod.id),
        val("10") ? sb.from("lots").select("id, lot_number, expiration_date").eq("product_id", prod.id).eq("lot_number", val("10")!).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const P = (pos as any[]) ?? [];
      out.stock = { total: P.reduce((a, x) => a + Number(x.quantity), 0), available: P.reduce((a, x) => a + Number(x.quantity) - Number(x.reserved), 0) };
      const lot = (lotRes as any).data; if (lot) out.lot = { ...lot, qty: P.filter((x) => x.lot_id === lot.id).reduce((a, x) => a + Number(x.quantity), 0) };
    }
  }
  const sscc = val("00");
  if (sscc && /^\d{18}$/.test(sscc)) { const { data } = await sb.from("shipments").select("id, sscc").eq("sscc", sscc).maybeSingle(); if (data) out.shipment = data; }
  return out;
}

/** Movimientos para EPCIS (con GLN de los depósitos y GTIN de los productos). */
export async function loadEpcisRows(sb: any, from?: string, to?: string): Promise<EpcisRow[]> {
  let q = sb.from("inventory_events").select("id, transaction_id, event_type, quantity, occurred_at, products(name, unit, gtin), lots(lot_number), from:warehouses!from_warehouse_id(gln), to:warehouses!to_warehouse_id(gln)").order("id").limit(5000);
  if (from) q = q.gte("occurred_at", `${from}T00:00:00-03:00`);
  if (to) q = q.lte("occurred_at", `${to}T23:59:59-03:00`);
  const { data, error } = await q; if (error) throw new Error(error.message);
  return ((data as any[]) ?? []).map((r) => ({ id: r.id, transaction_id: r.transaction_id, event_type: r.event_type, quantity: r.quantity, occurred_at: r.occurred_at, product: r.products ?? null, lot: r.lots?.lot_number ?? null, from_gln: r.from?.gln ?? null, to_gln: r.to?.gln ?? null }));
}
