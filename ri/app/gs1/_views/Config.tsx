import Alert from "@/components/Alert";
import { Card, Stepper, type Step } from "@/components/ui";
import { saveGs1Settings } from "@/app/gs1-actions";
import { getSettings } from "@/lib/gs1/data";
import { completeness, type Master } from "@/lib/gs1/master";
import { prefixInfo } from "@/lib/gs1/prefix";
import type { View, ViewCtx } from "@/lib/view";

export default async function ConfigView({ sb, org, role }: ViewCtx): Promise<View> {
  const admin = ["OWNER", "ADMIN"].includes(role);
  const [s, { data: prods }, { data: masters }, { data: whs }] = await Promise.all([
    getSettings(sb, org.id),
    sb.from("products").select("id, name, gtin").eq("organization_id", org.id).eq("is_active", true),
    sb.from("product_gs1").select("*").eq("organization_id", org.id),
    sb.from("warehouses").select("id, gln").eq("organization_id", org.id).eq("is_active", true),
  ]);
  const P = (prods as any[]) ?? [], M = new Map(((masters as any[]) ?? []).map((m) => [m.product_id, m as Master])), W = (whs as any[]) ?? [];
  const withGtin = P.filter((p) => p.gtin).length, avg = P.length ? Math.round(P.reduce((a, p) => a + completeness(p, M.get(p.id)).pct, 0) / P.length) : 0, withGln = W.filter((w) => w.gln).length;
  const pre = s.company_prefix ? prefixInfo(s.company_prefix.padEnd(13, "0")) : null;
  const done = [!!s.company_prefix, !!s.gln, P.length > 0 && withGtin === P.length, P.length > 0 && avg >= 80, W.length > 0 && withGln === W.length, s.public_enabled];
  const first = done.indexOf(false);
  const info: [string, string][] = [
    ["Prefijo de empresa GS1", "Se obtiene al asociarte a GS1 Argentina. Todos tus códigos nacen de él, así que ningún otro negocio puede repetirlos."],
    ["Información del GLN de empresa", `Identifica a tu empresa como entidad legal en el intercambio de datos (pedidos, facturas, EPCIS).`],
    [`GTIN en productos (${withGtin}/${P.length})`, "El código de barras de cada producto. Podés asignarlos automáticamente desde «Productos GS1»."],
    [`Datos maestros (${avg}% promedio)`, "Marca, contenido, pesos, medidas, origen y clasificación GPC: lo que piden las plataformas de sincronización de datos."],
    [`GLN de depósitos (${withGln}/${W.length})`, "Identifica cada ubicación física; se usa en EPCIS para decir dónde ocurrió cada movimiento."],
    ["Páginas públicas de producto", "Al escanear el QR (GS1 Digital Link) el consumidor ve la ficha y el lote. Es opcional y solo muestra datos de producto."],
  ];
  const steps: Step[] = info.map(([title, detail], i) => ({ title, detail, state: done[i] ? "done" : i === first ? "current" : "todo" }));
  const main = (
    <div className="grid gap-6">
      {!admin && <Alert tone="info" title="Solo lectura">Solo los dueños y administradores pueden cambiar la configuración GS1.</Alert>}
      <Card title="Tu identificación GS1" sub="Se guarda por empresa: cada una tiene su propio prefijo y numeración.">
        <form className="f" action={saveGs1Settings}>
          <input type="hidden" name="back" value="/gs1?v=config" />
          <fieldset disabled={!admin} className="f">
            <div className="fgrid">
              <label>Prefijo de empresa GS1 (6 a 12 dígitos)<input name="company_prefix" defaultValue={s.company_prefix ?? ""} inputMode="numeric" placeholder="Ej.: 7791234" /></label>
              <label>GLN de la empresa (13 dígitos)<input name="gln" defaultValue={s.gln ?? ""} inputMode="numeric" /></label>
            </div>
            {pre && <p className="text-sm text-mute">Ese prefijo corresponde a: <b>{pre.label}</b> (la organización GS1 que lo emitió).</p>}
            <label className="flex items-center gap-2 font-normal"><input type="checkbox" name="gen_gln" /> Generar el GLN de la empresa a partir del prefijo (si lo dejás vacío)</label>
            <label className="flex items-center gap-2 font-normal"><input type="checkbox" name="public_enabled" defaultChecked={s.public_enabled} /> Activar las páginas públicas de producto (resolvedor GS1 Digital Link)</label>
            <p className="text-sm text-mute">Sin prefijo propio podés usar códigos <b>internos</b> (rango de distribución restringida) para identificar productos dentro de tu empresa; para vender a terceros o en góndola necesitás tu prefijo.</p>
            <button className="btn btn-green justify-self-start">Guardar</button>
          </fieldset>
        </form>
      </Card>
      <Card title="Estado de tu implementación GS1"><Stepper steps={steps} /></Card>
      <Card title="Qué no incluye (requiere membresía GS1)">
        <ul className="grid gap-2 text-sm text-mute">
          <li><b>Prefijo y certificado de empresa:</b> los emite GS1 Argentina al asociarte.</li>
          <li><b>Sincronización de datos (GDSN / catálogos de GS1):</b> la app exporta las fichas en CSV y JSON-LD listas para cargar; el envío a la red lo hace tu organización GS1.</li>
          <li><b>Consultas externas (GEPIR, Verified by GS1, verificación de calidad de impresión):</b> son servicios de GS1 con acceso propio.</li>
        </ul>
      </Card>
    </div>
  );
  return { title: "Configuración GS1", intro: "Tu prefijo de empresa, tu GLN y el estado de todo lo que se construye a partir de ellos.", main };
}
