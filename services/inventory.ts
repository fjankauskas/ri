// Capa de servicios: toda operación de stock pasa por funciones SQL transaccionales (nunca UPDATE directo).
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
const id = z.string().uuid(), qty = z.coerce.number().positive("La cantidad debe ser mayor que cero");
export async function rpc(sb: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^[A-Z_]+: /, ""));
  return data;
}
export const stockIn = (sb: SupabaseClient, i: unknown) => {
  const v = z.object({ org: id, warehouse: id, product: id, lot: z.string().trim().min(1, "Indicá el lote"), qty, note: z.string().optional(), type: z.enum(["RECEIPT", "ADJUSTMENT"]), expires: z.string().optional() }).parse(i);
  if (v.type === "ADJUSTMENT" && !v.note?.trim()) throw new Error("El ajuste necesita un motivo");
  return rpc(sb, "stock_in", { p_org: v.org, p_wh: v.warehouse, p_product: v.product, p_lot: v.lot, p_qty: v.qty, p_note: v.note ?? null, p_type: v.type, p_expires: v.expires || null });
};
/** Mueve stock dentro de la empresa (TRANSFER) o lo da de baja (ADJUSTMENT con motivo). `position` = "depósito|producto|lote". */
export const moveStock = (sb: SupabaseClient, i: unknown) => {
  const v = z.object({ org: id, position: z.string(), to: id.optional(), qty, note: z.string().optional(), type: z.enum(["TRANSFER", "ADJUSTMENT", "SALE"]) }).parse(i);
  const [from, product, lot] = v.position.split("|");
  if (v.type === "ADJUSTMENT" && !v.note?.trim()) throw new Error("El ajuste necesita un motivo");
  if (v.type === "TRANSFER" && (!v.to || v.to === from)) throw new Error("Elegí un depósito de destino distinto");
  return rpc(sb, "inventory_apply", { p_org: v.org, p_type: v.type, p_note: v.note ?? null,
    p_legs: [{ product_id: product, lot_id: lot, from, to: v.type === "TRANSFER" ? v.to : null, qty: v.qty }] });
};
export const shipToOrg = (sb: SupabaseClient, i: unknown) => {
  const v = z.object({ position: z.string(), toOrg: id, qty }).parse(i);
  const [from, product, lot] = v.position.split("|");
  return rpc(sb, "ship_to_org", { p_from_wh: from, p_to_org: v.toOrg, p_product: product, p_lot: lot, p_qty: v.qty });
};
export const receiveShipment = (sb: SupabaseClient, i: unknown) => {
  const v = z.object({ ship: id, warehouse: id, qty }).parse(i);
  return rpc(sb, "receive_shipment", { p_ship: v.ship, p_to_wh: v.warehouse, p_qty: v.qty });
};
export const requestConnection = (sb: SupabaseClient, org: string, taxId: string) => rpc(sb, "request_connection", { p_my_org: org, p_tax_id: taxId });
export const acceptConnection = (sb: SupabaseClient, connId: string) => rpc(sb, "accept_connection", { p_id: connId });
export const call = rpc;
