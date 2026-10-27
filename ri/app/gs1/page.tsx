import { ctx } from "@/lib/ctx";
import Workspace, { type MenuItem } from "@/components/Workspace";
import { getBadges } from "@/lib/badges";
import type { SP } from "@/components/Shell";
import type { View, ViewCtx } from "@/lib/view";
import Config from "./_views/Config";
import GProducts from "./_views/Products";
import Labels from "./_views/Labels";
import Reader from "./_views/Reader";
import Locations from "./_views/Locations";
import Data from "./_views/Data";

const VIEWS: Record<string, (c: ViewCtx) => Promise<View>> = { products: GProducts, labels: Labels, reader: Reader, locations: Locations, data: Data, config: Config };
// GS1: identificación de productos (GTIN), códigos y etiquetas, lector, ubicaciones y logística (GLN/SSCC), EPCIS y configuración.
export default async function Gs1Page({ searchParams }: { searchParams: SP }) {
  const P = await searchParams;
  const c = await ctx();
  const badges = await getBadges(c.sb);
  const v = P.v && VIEWS[P.v] ? P.v : "products";
  const view = await VIEWS[v]({ ...c, P, badges });
  const items: MenuItem[] = [
    { key: "products", label: "Productos GS1", icon: "box" }, { key: "labels", label: "Códigos y etiquetas", icon: "barcode" }, { key: "reader", label: "Lector y decodificador", icon: "qr" },
    { key: "locations", label: "Ubicaciones y logística", icon: "pin" }, { key: "data", label: "EPCIS y datos", icon: "database" }, { key: "config", label: "Configuración", icon: "cog" },
  ];
  return <Workspace base="/gs1" items={items} active={v} org={c.org.display_name} params={P} badges={badges} title={view.title} intro={view.intro} aside={view.aside}>{view.main}</Workspace>;
}
