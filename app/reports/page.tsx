import { ctx } from "@/lib/ctx";
import Workspace, { type MenuItem } from "@/components/Workspace";
import { getBadges } from "@/lib/badges";
import type { SP } from "@/components/Shell";
import type { View, ViewCtx } from "@/lib/view";
import Sales from "./_views/Sales";
import Idle from "./_views/Idle";
import Margin from "./_views/Margin";
import Network from "./_views/Network";

const VIEWS: Record<string, (c: ViewCtx) => Promise<View>> = { sales: Sales, idle: Idle, margin: Margin, network: Network };
// Reportes: más y menos vendidos, productos sin movimiento, margen estimado y comercio con la red.
export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const P = await searchParams;
  const c = await ctx();
  const badges = await getBadges(c.sb);
  const v = P.v && VIEWS[P.v] ? P.v : "sales";
  const view = await VIEWS[v]({ ...c, P, badges });
  const items: MenuItem[] = [{ key: "sales", label: "Más y menos vendidos", icon: "summary" }, { key: "idle", label: "Sin movimiento", icon: "box" }, { key: "margin", label: "Margen estimado", icon: "receipt" }, { key: "network", label: "Comercio con la red", icon: "market" }];
  return <Workspace base="/reports" items={items} active={v} org={c.org.display_name} params={P} badges={badges} title={view.title} intro={view.intro} aside={view.aside}>{view.main}</Workspace>;
}
