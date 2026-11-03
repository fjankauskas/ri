import { ctx } from "@/lib/ctx";
import Workspace, { type MenuItem } from "@/components/Workspace";
import { getBadges } from "@/lib/badges";
import type { SP } from "@/components/Shell";
import type { View, ViewCtx } from "@/lib/view";
import Orders from "./_views/Orders";
import Suppliers from "./_views/Suppliers";
import Invoices from "./_views/Invoices";
import Prices from "./_views/Prices";

const VIEWS: Record<string, (c: ViewCtx) => Promise<View>> = { orders: Orders, suppliers: Suppliers, invoices: Invoices, prices: Prices };
// Compras: órdenes de compra con recepciones parciales, proveedores, facturas de proveedor y comparador de precios.
export default async function PurchasesPage({ searchParams }: { searchParams: SP }) {
  const P = await searchParams;
  const c = await ctx();
  const badges = await getBadges(c.sb);
  const v = P.v && VIEWS[P.v] ? P.v : "orders";
  const view = await VIEWS[v]({ ...c, P, badges });
  const items: MenuItem[] = [{ key: "orders", label: "Órdenes de compra", icon: "orders" }, { key: "suppliers", label: "Proveedores", icon: "partners" }, { key: "invoices", label: "Facturas de proveedores", icon: "receipt" }, { key: "prices", label: "Precios y comparador", icon: "summary" }];
  return <Workspace base="/purchases" items={items} active={v} org={c.org.display_name} params={P} badges={badges} title={view.title} intro={view.intro} aside={view.aside}>{view.main}</Workspace>;
}
