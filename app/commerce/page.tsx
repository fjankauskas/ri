import { ctx } from "@/lib/ctx";
import Workspace, { type MenuItem } from "@/components/Workspace";
import { getBadges } from "@/lib/badges";
import type { SP } from "@/components/Shell";
import type { View, ViewCtx } from "@/lib/view";
import Sales from "./_views/Sales";
import Customers from "./_views/Customers";
import Purchases from "./_views/Purchases";
import Suppliers from "./_views/Suppliers";
import Prices from "./_views/Prices";
import Invoices from "./_views/Invoices";
import Arca from "./_views/Arca";

const VIEWS: Record<string, (c: ViewCtx) => Promise<View>> = { sales: Sales, customers: Customers, purchases: Purchases, suppliers: Suppliers, prices: Prices, invoices: Invoices, arca: Arca };
// Compras y ventas en una sola pantalla: ventas y clientes, órdenes de compra y proveedores, precios, todas las facturas (emitidas y recibidas) y la configuración de ARCA.
export default async function CommercePage({ searchParams }: { searchParams: SP }) {
  const P = await searchParams;
  const c = await ctx();
  const badges = await getBadges(c.sb);
  const v = P.v && VIEWS[P.v] ? P.v : "sales";
  const view = await VIEWS[v]({ ...c, P, badges });
  const items: MenuItem[] = [
    { key: "sales", label: "Ventas", icon: "receipt", group: "Ventas" }, { key: "customers", label: "Clientes", icon: "partners" },
    { key: "purchases", label: "Órdenes de compra", icon: "orders", group: "Compras" }, { key: "suppliers", label: "Proveedores", icon: "partners" }, { key: "prices", label: "Precios y comparador", icon: "summary" },
    { key: "invoices", label: "Facturas", icon: "receipt", group: "Facturación" }, { key: "arca", label: "Configuración ARCA", icon: "shield" },
  ];
  return <Workspace base="/commerce" items={items} active={v} org={c.org.display_name} params={P} badges={badges} title={view.title} intro={view.intro} aside={view.aside}>{view.main}</Workspace>;
}
