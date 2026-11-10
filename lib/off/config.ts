// Configuración de la integración con Open Food Facts (OFF). Todo se puede ajustar con variables de entorno.
export const DEFAULT_FIELDS = ["product_name", "generic_name", "brands", "quantity"] as const;
export type Field = (typeof DEFAULT_FIELDS)[number];
export type OffConfig = {
  contactEmail: string; appName: string; appVersion: string; userAgentOverride: string;
  fields: Field[];                  // campos descriptivos que se guardan (code y last_modified_t son obligatorios)
  productPerMinute: number;         // tope propio de consultas por escaneo (OFF permite 100/min)
  negativeTtlDays: number;          // cuánto se recuerda que OFF no tiene un GTIN
  emptyTtlDays: number;             // ídem cuando OFF lo tiene pero sin datos útiles
  requestTimeoutMs: number; maxRetries: number; failuresBeforeBreak: number; breakSeconds: number;
  batchSize: number; fullRefreshDays: number; staleRunMinutes: number;
  csvUrl: string; deltaIndexUrl: string; deltaBaseUrl: string; apiBase: string; alertWebhook: string;
};
const int = (v: string | undefined, d: number, min = 1) => { const n = Number(v); return Number.isFinite(n) && n >= min ? Math.floor(n) : d; };
export function configFromEnv(env: Record<string, string | undefined> = process.env): OffConfig {
  const wanted = (env.OFF_FIELDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const fields = wanted.length ? (DEFAULT_FIELDS.filter((f) => wanted.includes(f)) as Field[]) : [...DEFAULT_FIELDS];
  return {
    contactEmail: (env.OFF_CONTACT_EMAIL ?? "").trim(), appName: env.OFF_APP_NAME?.trim() || "RedDeInventario", appVersion: env.OFF_APP_VERSION?.trim() || "1.0", userAgentOverride: (env.OFF_USER_AGENT ?? "").trim(),
    fields, productPerMinute: int(env.OFF_PRODUCT_RPM, 60), negativeTtlDays: int(env.OFF_NEG_TTL_DAYS, 7), emptyTtlDays: int(env.OFF_EMPTY_TTL_DAYS, 1),
    requestTimeoutMs: int(env.OFF_TIMEOUT_MS, 4000), maxRetries: int(env.OFF_MAX_RETRIES, 2, 0), failuresBeforeBreak: int(env.OFF_FAILURES_BEFORE_BREAK, 3), breakSeconds: int(env.OFF_BREAK_SECONDS, 120),
    batchSize: int(env.OFF_BATCH_SIZE, 1000), fullRefreshDays: int(env.OFF_FULL_REFRESH_DAYS, 30), staleRunMinutes: int(env.OFF_STALE_RUN_MINUTES, 30),
    csvUrl: env.OFF_EXPORT_CSV_URL?.trim() || "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz",
    deltaIndexUrl: env.OFF_DELTA_INDEX_URL?.trim() || "https://static.openfoodfacts.org/data/delta/index.txt",
    deltaBaseUrl: env.OFF_DELTA_BASE_URL?.trim() || "https://static.openfoodfacts.org/data/delta/",
    apiBase: (env.OFF_API_BASE?.trim() || "https://world.openfoodfacts.org").replace(/\/$/, ""), alertWebhook: (env.OFF_ALERT_WEBHOOK_URL ?? "").trim(),
  };
}
/** User-Agent descriptivo con un contacto válido (lo pide OFF). Sin contacto no se hacen consultas externas. */
export function userAgent(c: OffConfig): string | null {
  if (c.userAgentOverride) return c.userAgentOverride;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.contactEmail) ? `${c.appName}/${c.appVersion} (${c.contactEmail})` : null;
}
export const NO_CONTACT_MESSAGE = "Para consultar Open Food Facts hay que configurar OFF_CONTACT_EMAIL (un email de contacto que se envía en el User-Agent, como pide OFF).";
export const OFF_ATTRIBUTION = "Contiene información de Open Food Facts (openfoodfacts.org), disponible bajo la licencia Open Database License (ODbL) 1.0.";
export const OFF_LICENSE_URL = "https://opendatacommons.org/licenses/odbl/1-0/";
