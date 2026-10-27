import { ctx } from "@/lib/ctx";
import Workspace, { type MenuItem } from "@/components/Workspace";
import { getBadges } from "@/lib/badges";
import type { SP } from "@/components/Shell";
import type { View, ViewCtx } from "@/lib/view";
import Orders from "./_views/Orders";
import Partners from "./_views/Partners";
import Market from "./_views/Market";
import Shipments from "./_views/Shipments";

const VIEWS: Record<string, (c: ViewCtx) => Promise<View>> = { orders: Orders, partners: Partners, market: Market, shipments: Shipments };
// Red: Pedidos, Empresas conectadas, Stock de la red (con publicación propia) y Envíos.
export default async function Network({ searchParams }: { searchParams: SP }) {
  const P = await searchParams;
  const c = await ctx();
  const badges = await getBadges(c.sb);
  const v = P.v && VIEWS[P.v] ? P.v : "orders";
  const view = await VIEWS[v]({ ...c, P, badges });
  const items: MenuItem[] = [
    { key: "orders", label: "Pedidos", icon: "orders", badge: badges.requests + badges.dispatch },
    { key: "partners", label: "Empresas conectadas", icon: "partners" },
    { key: "market", label: "Stock de la red", icon: "market" },
    { key: "shipments", label: "Envíos", icon: "truck", badge: badges.incoming },
  ];
  return <Workspace base="/network" items={items} active={v} org={c.org.display_name} params={P} badges={badges} title={view.title} intro={view.intro} aside={view.aside}>{view.main}</Workspace>;
}
