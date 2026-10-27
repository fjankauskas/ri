import type { Badges } from "./view";
// Contadores para los globitos de notificación: lo que está esperando una acción tuya.
export async function getBadges(sb: any): Promise<Badges> {
  const [reqs, ships, ords, al] = await Promise.all([sb.rpc("my_purchase_requests"), sb.rpc("my_shipments"), sb.rpc("my_orders"), sb.rpc("my_alerts")]);
  const list = (r: any) => ((r.data as any[]) ?? []);
  return {
    requests: list(reqs).filter((r) => r.direction === "RECEIVED" && r.status === "REQUESTED").length,
    incoming: list(ships).filter((s) => s.direction === "IN" && s.status === "IN_TRANSIT").length,
    dispatch: list(ords).filter((o) => o.direction === "OUT" && o.status === "CONFIRMED").length,
    alerts: list(al).length,
  };
}
