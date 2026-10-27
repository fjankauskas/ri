import { createHash } from "node:crypto";
import { toGtin14, validateGtin } from "./check";
import { lgtinUrn, sglnUrn, ssccUrn } from "./epc";
import { UNIT_TO_UOM } from "./master";
// Eventos EPCIS 2.0 (ISO/IEC 19987) a partir de los movimientos de inventario, con identificadores GS1 (LGTIN, SGLN, SSCC) y vocabulario CBV.
export type EpcisRow = {
  id: number | string; transaction_id: string | null; event_type: string; quantity: number | string; occurred_at: string;
  product: { name: string; unit: string; gtin: string | null } | null; lot: string | null; from_gln: string | null; to_gln: string | null; sscc?: string | null;
};
export type EpcisSettings = { company_prefix: string | null; gln: string | null };
const CBV = "https://ref.gs1.org/cbv/";
const STEP: Record<string, [string, string, string | null]> = {   // tipo → [bizStep, action, disposition]
  RECEIPT: ["receiving", "OBSERVE", "in_progress"], SHIPMENT: ["shipping", "OBSERVE", "in_transit"], TRANSFER: ["storing", "OBSERVE", "in_progress"],
  SALE: ["retail_selling", "OBSERVE", "retail_sold"], PRODUCTION_OUTPUT: ["commissioning", "ADD", "active"], ADJUSTMENT: ["cycle_counting", "OBSERVE", null],
};
/** UUID determinístico (v5 sobre SHA-1) para que el mismo evento siempre tenga el mismo eventID. */
export function uuidFrom(seed: string): string {
  const h = createHash("sha1").update("red-inventario:" + seed).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
export type EpcisResult = { doc: Record<string, unknown>; mapped: number; unmapped: number; reasons: Record<string, number> };
export function buildEpcis(rows: EpcisRow[], s: EpcisSettings, now = new Date()): EpcisResult {
  const cpLen = s.company_prefix?.length ?? null, reasons: Record<string, number> = {};
  const skip = (why: string, n = 1) => { reasons[why] = (reasons[why] ?? 0) + n; };
  const loc = (gln: string | null) => { const g = gln ?? s.gln; return g && cpLen ? { id: sglnUrn(g, cpLen) } : g ? { id: `https://id.gs1.org/414/${g}` } : undefined; };
  const item = (r: EpcisRow) => {
    const g = r.product?.gtin; if (!g || !validateGtin(g).ok) return null; if (!r.lot) return null;
    const u = UNIT_TO_UOM[r.product!.unit], q = Number(r.quantity), g14 = toGtin14(g);
    const epcClass = cpLen ? lgtinUrn(g14, r.lot, cpLen) : `https://id.gs1.org/01/${g14}/10/${encodeURIComponent(r.lot)}`;
    return { epcClass, quantity: q, ...(u && u !== "C62" && u !== "XBX" && u !== "XPK" && u !== "XBG" && u !== "DZN" ? { uom: u } : {}) };
  };
  const events: Record<string, unknown>[] = [], byTx = new Map<string, EpcisRow[]>();
  for (const r of rows) { if (r.event_type.startsWith("PRODUCTION") && r.transaction_id) { byTx.set(r.transaction_id, [...(byTx.get(r.transaction_id) ?? []), r]); } }
  const done = new Set<string>();
  const base = (r: EpcisRow) => ({ eventTime: new Date(r.occurred_at).toISOString(), eventTimeZoneOffset: "-03:00" });
  for (const r of rows) {
    if (r.event_type.startsWith("PRODUCTION") && r.transaction_id) {
      if (done.has(r.transaction_id)) continue; done.add(r.transaction_id);
      const grp = byTx.get(r.transaction_id)!, ins = grp.filter((x) => x.event_type === "PRODUCTION_INPUT").map(item), outs = grp.filter((x) => x.event_type === "PRODUCTION_OUTPUT").map(item);
      if (!outs.length || ins.some((x) => !x) || outs.some((x) => !x)) { skip("producción con productos sin GTIN o sin lote", grp.length); continue; }
      const where = loc(grp[0].to_gln ?? grp[0].from_gln);
      events.push({ type: "TransformationEvent", eventID: `urn:uuid:${uuidFrom("tx:" + r.transaction_id)}`, ...base(grp[0]), transformationID: `urn:uuid:${uuidFrom("trf:" + r.transaction_id)}`, bizStep: `${CBV}BizStep-commissioning`, ...(where ? { readPoint: where, bizLocation: where } : {}), inputQuantityList: ins, outputQuantityList: outs });
      continue;
    }
    const map = STEP[r.event_type]; if (!map) { skip(`tipo de movimiento sin equivalente (${r.event_type})`); continue; }
    const it = item(r); if (!it) { skip(r.product?.gtin ? "lote sin dato" : "producto sin GTIN válido"); continue; }
    const where = loc(r.event_type === "RECEIPT" || r.event_type === "TRANSFER" ? r.to_gln : r.from_gln);
    const ev: Record<string, unknown> = { type: "ObjectEvent", eventID: `urn:uuid:${uuidFrom("ev:" + r.id)}`, ...base(r), action: map[1], bizStep: `${CBV}BizStep-${map[0]}`, ...(map[2] ? { disposition: `${CBV}Disp-${map[2]}` } : {}), ...(where ? { readPoint: where, bizLocation: where } : {}), quantityList: [it] };
    if (r.sscc && cpLen && (r.event_type === "SHIPMENT" || r.event_type === "RECEIPT")) ev.epcList = [ssccUrn(r.sscc, cpLen)];
    events.push(ev);
  }
  const unmapped = Object.values(reasons).reduce((a, b) => a + b, 0);
  return { doc: { "@context": ["https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld"], type: "EPCISDocument", schemaVersion: "2.0", creationDate: now.toISOString(), epcisBody: { eventList: events } }, mapped: events.length, unmapped, reasons };
}
