import Link from "next/link";
import { Card, Empty } from "@/components/ui";
import { ProduceForm } from "@/components/ProductionForms";
import RecipeEditor from "@/components/RecipeEditor";
import { n, when } from "@/lib/format";
import type { View, ViewCtx } from "@/lib/view";

export default async function ProductionView({ sb, role, P }: ViewCtx): Promise<View> {
  const canWrite = role !== "VIEWER";
  const [prods, whs, boms, done] = await Promise.all([
    sb.from("products").select("id, sku, name, unit").eq("is_active", true).order("name"),
    sb.from("warehouses").select("id, name").eq("is_active", true),
    // Los "!" desambiguan la relación: bom_items es una tabla puente entre recetas y productos
    sb.from("bill_of_materials").select("id, product_id, products!product_id(name, unit), bom_items(component_id, qty_per_unit, products!component_id(name, sku, unit))").eq("is_active", true),
    sb.from("inventory_events").select("id, quantity, occurred_at, lot_id, products(name, unit), lots(lot_number)").eq("event_type", "PRODUCTION_OUTPUT").order("id", { ascending: false }).limit(15),
  ]);
  const PR = (prods.data as any[]) ?? [], B = (boms.data as any[]) ?? [], H = (done.data as any[]) ?? [];
  const recipes: Record<string, { component: string; qty: string }[]> = {};
  for (const b of B) recipes[b.product_id] = (b.bom_items ?? []).map((i: any) => ({ component: i.component_id, qty: String(i.qty_per_unit) }));
  const back = "/inventory?v=production";
  const main = (
    <div className="grid gap-8">
      {boms.error && <p role="alert" className="text-bad">No se pudieron leer las recetas: {boms.error.message}</p>}
      {canWrite && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Producir" sub="Registra la producción y descuenta los insumos de la receta."><ProduceForm boms={B} whs={(whs.data as any[]) ?? []} back={back} selected={P.produce} /></Card>
          <Card title="Receta" sub="Insumos necesarios por cada unidad producida. Podés agregar todos los que necesites."><RecipeEditor key={P.edit || "nuevo"} prods={PR} recipes={recipes} back={back} initial={P.edit} /></Card>
        </div>
      )}
      <div>
        <h2 className="mb-3">Recetas activas</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {B.map((b) => (
            <div key={b.id} className="rounded-xl border border-line bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base">{b.products.name}</h3>
                <Link href={`/inventory?v=products&id=${b.product_id}`} className="text-sm">Ver producto</Link>
              </div>
              <ul className="mt-3 grid gap-1 text-sm text-mute">
                {(b.bom_items ?? []).map((i: any) => <li key={i.component_id}>{n(i.qty_per_unit)} {i.products.unit} de <Link href={`/inventory?v=products&id=${i.component_id}`}>{i.products.name}</Link></li>)}
              </ul>
              {canWrite && (
                <div className="mt-4 flex gap-2">
                  <Link href={`/inventory?v=production&edit=${b.product_id}`} className="btn btn-gray btn-sm no-underline">Editar receta</Link>
                  <Link href={`/inventory?v=production&produce=${b.product_id}`} className="btn btn-green btn-sm">Producir</Link>
                </div>
              )}
            </div>
          ))}
          {!B.length && <p className="text-mute">Todavía no hay recetas. Armá una con el formulario de arriba.</p>}
        </div>
      </div>
      <div>
        <h2 className="mb-3">Producciones recientes</h2>
        <div className="tw"><table>
          <thead><tr><th>Fecha</th><th>Producto</th><th>Lote (ver trazabilidad)</th><th className="n">Cantidad</th></tr></thead>
          <tbody>
            {H.map((e) => <tr key={e.id}><td>{when(e.occurred_at)}</td><td className="k">{e.products.name}</td><td><Link href={`/inventory?v=trace&lot=${e.lot_id}`}>{e.lots.lot_number}</Link></td><td className="n">{n(e.quantity)} {e.products.unit}</td></tr>)}
            {!H.length && <Empty cols={4}>Todavía no produjiste nada. Tocá el lote de una producción para ver de qué insumos salió y a quién llegó.</Empty>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
  return { title: "Producción", intro: "Armá recetas, registrá producciones y seguí qué lotes salieron de cada una.", main };
}
