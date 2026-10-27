import { ctx } from "@/lib/ctx";
import Workspace, { type MenuItem } from "@/components/Workspace";
import { getBadges } from "@/lib/badges";
import type { SP } from "@/components/Shell";
import type { View, ViewCtx } from "@/lib/view";
import Summary from "./_views/Summary";
import Products from "./_views/Products";
import Production from "./_views/Production";
import Trace from "./_views/Trace";

const VIEWS: Record<string, (c: ViewCtx) => Promise<View>> = { summary: Summary, products: Products, production: Production, trace: Trace };
// Inventario: Resumen, Productos y stock, Producción y Trazabilidad (incluye el escáner y la exportación EPCIS).
export default async function Inventory({ searchParams }: { searchParams: SP }) {
  const P = await searchParams;
  const c = await ctx();
  const badges = await getBadges(c.sb);
  const v = P.v && VIEWS[P.v] ? P.v : "summary";
  const view = await VIEWS[v]({ ...c, P, badges });
  const items: MenuItem[] = [
    { key: "summary", label: "Resumen", icon: "summary", badge: badges.alerts },
    { key: "products", label: "Productos y stock", icon: "box" },
    { key: "production", label: "Producción", icon: "factory" },
    { key: "trace", label: "Trazabilidad", icon: "route" },
  ];
  return <Workspace base="/inventory" items={items} active={v} org={c.org.display_name} params={P} badges={badges} title={view.title} intro={view.intro} aside={view.aside}>{view.main}</Workspace>;
}
