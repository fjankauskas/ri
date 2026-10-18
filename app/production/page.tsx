import { ctx } from "@/lib/ctx";
import Shell, { type SP } from "@/components/Shell";
import Can from "@/components/Can";
import { ProduceForm } from "@/components/ProductionForms";
import RecipeEditor from "@/components/RecipeEditor";
import { n, when } from "@/lib/format";
export default async function Production({ searchParams }: { searchParams: SP }) {
  const { sb, org, role } = await ctx();
  const { edit = "" } = await searchParams;
  const [prods, whs, boms, done] = await Promise.all([
    sb.from("products").select("id, sku, name, unit").eq("is_active", true).order("name"),
    sb.from("warehouses").select("id, name").eq("is_active", true),
    // Los "!" desambiguan la relación: bom_items es una tabla puente entre recetas y productos
    sb.from("bill_of_materials").select("id, product_id, products!product_id(name, unit), bom_items(component_id, qty_per_unit, products!component_id(name, sku, unit))").eq("is_active", true),
    sb.from("inventory_events").select("id, quantity, occurred_at, lot_id, products(name, unit), lots(lot_number)").eq("event_type", "PRODUCTION_OUTPUT").order("id", { ascending: false }).limit(15),
  ]);
  const P = prods.data ?? [], B = (boms.data as any[]) ?? [], H = (done.data as any[]) ?? [];
  const recipes: Record<string, { component: string; qty: string }[]> = {};
  for (const b of B) recipes[b.product_id] = (b.bom_items ?? []).map((i: any) => ({ component: i.component_id, qty: String(i.qty_per_unit) }));
  return (
    <Shell org={org.display_name} sp={searchParams}>
      {boms.error && <p role="alert" className="msg bad">No se pudieron leer las recetas: {boms.error.message}</p>}
      <Can role={role}><div className="grid">
        <section id="receta"><h2>Receta (BOM)</h2><RecipeEditor key={edit || "nuevo"} prods={P} recipes={recipes} back="/production" initial={edit} /></section>
        <section><h2>Producir</h2><ProduceForm boms={B} whs={whs.data ?? []} back="/production" /></section>
      </div></Can>
      <section><h2>Recetas activas</h2>
        {B.map((b) => <p key={b.id}><b>{b.products.name}</b>: {(b.bom_items ?? []).map((i: any) => `${n(i.qty_per_unit)} ${i.products.unit} de ${i.products.name}`).join(", ")} <Can role={role}><a href={`/production?edit=${b.product_id}#receta`}>Editar</a></Can></p>)}
        {!B.length && <p className="mu">Todavía no hay recetas. Cargá una para empezar a producir.</p>}</section>
      <section><h2>Producciones recientes</h2><table><thead><tr><th>Fecha</th><th>Producto</th><th>Lote (ver trazabilidad)</th><th className="n">Cantidad</th></tr></thead><tbody>
        {H.map((e) => <tr key={e.id}><td>{when(e.occurred_at)}</td><td>{e.products.name}</td><td><a href={`/trace?lot=${e.lot_id}`}>{e.lots.lot_number}</a></td><td className="n">{n(e.quantity)} {e.products.unit}</td></tr>)}
        {!H.length && <tr><td colSpan={4} className="mu">Todavía no produjiste nada. Tocá el lote de una producción para ver de qué insumos salió y a quién llegó.</td></tr>}</tbody></table></section>
    </Shell>
  );
}
