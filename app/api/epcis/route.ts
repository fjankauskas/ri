import { ctx } from "@/lib/ctx";
// Exporta los eventos de tu empresa como documento EPCIS 2.0 (JSON-LD).
// Los identificadores usan un esquema provisorio: mapeá SKU→GTIN y depósito→GLN para uso con GS1.
const STEP: Record<string, string> = { RECEIPT: "receiving", SHIPMENT: "shipping", TRANSFER: "storing", SALE: "retail_selling", PRODUCTION_OUTPUT: "commissioning", PRODUCTION_INPUT: "transforming", ADJUSTMENT: "inventory_adjustment" };
export async function GET() {
  const { sb } = await ctx();
  const { data } = await sb.from("inventory_events").select("id, event_type, quantity, occurred_at, to_warehouse_id, from_warehouse_id, products(sku, unit), lots(lot_number)").order("id").limit(5000);
  const events = ((data as any[]) ?? []).map((e) => ({
    type: "ObjectEvent", eventID: `urn:uuid:event:${e.id}`, eventTime: e.occurred_at, eventTimeZoneOffset: "+00:00",
    action: e.to_warehouse_id && !e.from_warehouse_id ? "ADD" : e.from_warehouse_id && !e.to_warehouse_id ? "DELETE" : "OBSERVE",
    bizStep: `https://ref.gs1.org/cbv/BizStep-${STEP[e.event_type] ?? "storing"}`,
    ...(e.to_warehouse_id ? { readPoint: { id: `urn:rdi:warehouse:${e.to_warehouse_id}` } } : {}),
    quantityList: [{ epcClass: `urn:rdi:product:${e.products.sku}:lot:${e.lots.lot_number}`, quantity: Number(e.quantity), uom: e.products.unit }],
  }));
  const doc = { "@context": ["https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld"], type: "EPCISDocument", schemaVersion: "2.0", creationDate: new Date().toISOString(), epcisBody: { eventList: events } };
  return new Response(JSON.stringify(doc, null, 2), { headers: { "Content-Type": "application/ld+json", "Content-Disposition": "attachment; filename=epcis-eventos.json" } });
}
