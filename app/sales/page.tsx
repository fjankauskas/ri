import { ctx } from "@/lib/ctx";
import Workspace, { type MenuItem } from "@/components/Workspace";
import { getBadges } from "@/lib/badges";
import type { SP } from "@/components/Shell";
import type { View, ViewCtx } from "@/lib/view";
import Sales from "./_views/Sales";
import Customers from "./_views/Customers";
import Invoices from "./_views/Invoices";
import Arca from "./_views/Arca";

const VIEWS: Record<string, (c: ViewCtx) => Promise<View>> = { sales: Sales, customers: Customers, invoices: Invoices, arca: Arca };
// Ventas: ventas con descuento de stock, clientes, comprobantes electrónicos y la configuración de ARCA de la empresa.
export default async function SalesPage({ searchParams }: { searchParams: SP }) {
  const P = await searchParams;
  const c = await ctx();
  const badges = await getBadges(c.sb);
  const v = P.v && VIEWS[P.v] ? P.v : "sales";
  const view = await VIEWS[v]({ ...c, P, badges });
  const items: MenuItem[] = [
    { key: "sales", label: "Ventas", icon: "receipt" },
    { key: "customers", label: "Clientes", icon: "users" },
    { key: "invoices", label: "Comprobantes", icon: "orders" },
    { key: "arca", label: "Facturación ARCA", icon: "shield" },
  ];
  return <Workspace base="/sales" items={items} active={v} org={c.org.display_name} params={P} badges={badges} title={view.title} intro={view.intro} aside={view.aside}>{view.main}</Workspace>;
}
