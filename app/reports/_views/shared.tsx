import { periods, rangeLastDays, salesLines, type Channel, type Line, type SalesRow } from "@/lib/reports";
import { FilterMenu } from "@/components/ui";
import { mk } from "@/lib/url";
import type { Params } from "@/lib/url";
export const CHANNELS: [string, string][] = [["all", "Todos los canales"], ["consumer", "Consumidores"], ["network", "Red de empresas"]];
export type Loaded = { rows: SalesRow[]; lines: Line[]; from: string; to: string; days: number; channel: Channel; error: string };
/** Carga las ventas del período (consumidores + envíos a la red) y arma una línea por producto. */
export async function loadSales(sb: any, orgId: string, P: Params): Promise<Loaded> {
  const days = periods.find(([k]) => k === P.d)?.[2] ?? 30, channel = (["consumer", "network"].includes(P.c ?? "") ? P.c : "all") as Channel, { from, to } = rangeLastDays(days);
  const { data, error } = await sb.rpc("report_sales", { p_org: orgId, p_from: from, p_to: to });
  const rows = ((data as SalesRow[]) ?? []);
  return { rows, lines: salesLines(rows, channel), from, to, days, channel, error: error ? error.message : "" };
}
export function Filters({ base, v, P, by }: { base: string; v: string; P: Params; by?: boolean }) {
  const L = (patch: Record<string, string | null>) => mk(base, { ...P, v }, patch);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <FilterMenu label="Período" value={P.d ?? "30"} options={periods.map(([key, label]) => ({ key, label, href: L({ d: key === "30" ? null : key }) }))} />
      <FilterMenu label="Canal" value={P.c ?? "all"} options={CHANNELS.map(([key, label]) => ({ key, label, href: L({ c: key === "all" ? null : key }) }))} />
      {by && <FilterMenu label="Ordenar por" value={P.by ?? "qty"} options={[["qty", "Unidades"], ["revenue", "Ingresos"], ["margin", "Margen"]].map(([key, label]) => ({ key, label, href: L({ by: key === "qty" ? null : key }) }))} />}
    </div>
  );
}
export const Kpi = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="rounded-xl border border-line bg-card p-5"><p className="text-sm text-mute">{label}</p><p className="mt-2 text-2xl font-light">{value}</p>{hint && <p className="mt-1 text-xs text-mute">{hint}</p>}</div>
);
export const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1).replace(".", ",")} %`);
