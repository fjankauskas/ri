import type { OffConfig } from "./config";
import type { AlertKind, OffStore } from "./store";
/** Avisa por un webhook (opcional: OFF_ALERT_WEBHOOK_URL). Es un mensaje de texto compatible con Slack, Discord (con /slack) y similares. */
export async function webhook(cfg: OffConfig, kind: AlertKind, message: string, f: typeof fetch = fetch): Promise<void> {
  if (!cfg.alertWebhook) return;
  try { await f(cfg.alertWebhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `[Red de Inventario · Open Food Facts] ${message}`, kind }), signal: AbortSignal.timeout(5000) }); } catch { /* un aviso fallido nunca debe romper la operación */ }
}
/** Para las consultas bajo demanda: registra la alerta (una por hora y tipo) y, si es nueva, avisa. */
export const alertNotifier = (store: OffStore, cfg: OffConfig) => async (kind: "api_down" | "rate_limited", message: string) => { if (await store.addAlert(kind, message)) await webhook(cfg, kind, message); };
