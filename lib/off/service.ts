import { createAdmin } from "@/lib/supabase/admin";
import { configFromEnv, userAgent } from "./config";
import { offLookup, type OffResult } from "./lookup";
import { alertNotifier } from "./notify";
import { supabaseStore, type OffRow } from "./store";
// Conexión con la app: consulta de un GTIN (catálogo local y, si falta, Open Food Facts) y datos para la pantalla de administración.
export const offConfigured = () => !!userAgent(configFromEnv());
export async function lookupOff(input: string, opts: { localOnly?: boolean } = {}): Promise<OffResult> {
  try {
    const store = supabaseStore(createAdmin()), cfg = configFromEnv();
    return await offLookup({ store, cfg, notify: alertNotifier(store, cfg) }, input, opts);
  } catch (e: any) { return { status: "unavailable", message: e?.message ? String(e.message) : "No se pudo consultar el catálogo." }; }
}
export async function catalogOverview() {
  const sb = createAdmin(), store = supabaseStore(sb);
  const [counts, runs, alerts] = await Promise.all([
    store.counts(),
    sb.from("off_import_runs").select("*").order("started_at", { ascending: false }).limit(10),
    sb.from("off_alerts").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(10),
  ]);
  return { counts, runs: (runs.data as any[]) ?? [], alerts: (alerts.data as any[]) ?? [], error: runs.error?.message ?? alerts.error?.message ?? "" };
}
export type { OffRow, OffResult };
