export const n = (x: number | string) => Number(x).toLocaleString("es-AR", { maximumFractionDigits: 3 });
export const money = (x: number | string | null | undefined) => (x == null || x === "" ? "—" : Number(x).toLocaleString("es-AR", { style: "currency", currency: "ARS" }));
export const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
export const when = (t: string) => new Date(t).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
export const TYPES: Record<string, string> = { RECEIPT: "Recepción", SHIPMENT: "Despacho", TRANSFER: "Transferencia", SALE: "Venta", PRODUCTION_INPUT: "Consumo", PRODUCTION_OUTPUT: "Producción", ADJUSTMENT: "Ajuste" };
export const posValue = (p: any) => `${p.warehouse_id}|${p.product_id}|${p.lot_id}`;
export const posLabel = (p: any) => `${p.products.name} · lote ${p.lots.lot_number} · ${p.warehouses.name} (disp. ${n(p.quantity - p.reserved)} ${p.products.unit})${p.products.price != null ? " · " + priceLabel(p.products.price, p.products.price_per, p.products.unit) : ""}`;
export const POS_SELECT = "quantity, reserved, warehouse_id, product_id, lot_id, warehouses(name), products(name, unit), lots(lot_number)";
export const POS_P = "quantity, reserved, warehouse_id, product_id, lot_id, warehouses(name), products(name, unit, price, price_per), lots(lot_number)";
type Num = number | string | null | undefined;
// Precio "por cantidad": $price cada price_per unidades (ej. $200.000 cada 1.000 kg)
export function priceLabel(price: Num, per: Num, unit: string) {
  if (price == null || price === "") return "sin precio";
  const k = Number(per ?? 1) || 1;
  return k === 1 ? `${money(price)} por ${unit}` : `${money(price)} cada ${n(k)} ${unit}`;
}
export function total(qty: number, price: Num, per: Num): number | null {
  if (price == null || price === "" || !(qty > 0)) return null;
  const k = Number(per ?? 1) || 1;
  return Math.round((qty / k) * Number(price) * 100) / 100;
}
