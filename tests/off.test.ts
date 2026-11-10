import assert from "node:assert/strict";
import { gtin13 } from "../lib/gs1/keys";
import { configFromEnv, userAgent } from "../lib/off/config";
import { normalizeRaw, parseQuantity, suggestedName, displayName } from "../lib/off/normalize";
import { csvSource, jsonlSource, parseDeltaIndex, planDelta, FormatError } from "../lib/off/export";
import { offLookup } from "../lib/off/lookup";
import { syncOnce, decideMode, SyncBusyError, type Plan } from "../lib/off/sync";
import { memoryStore } from "./memoryStore";
// Ejecutar: npx tsx tests/off.test.ts   (datos de ejemplo: no depende de Open Food Facts ni de la base)

let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log("  ✔", name); } catch (e: any) { console.error("  ✖", name, "\n   ", e?.message ?? e); process.exitCode = 1; } };
const AR = "en:argentina";
let clock = Date.UTC(2026, 10, 7, 12), advance = (ms: number) => (clock += ms);
const cfg = (over: Record<string, string> = {}) => configFromEnv({ OFF_CONTACT_EMAIL: "equipo@ejemplo.com.ar", OFF_BATCH_SIZE: "2", ...over });
const fastSleep = async () => {};
const mk = (n: number) => gtin13("7791234", n);

// ----- falsificador de la API v3 -----
type Reply = { status: number; body?: unknown; retry?: string } | "throw";
function fakeApi(handler: (code: string, n: number) => Reply | Promise<Reply>) {
  const log: string[] = []; const counts = new Map<string, number>();
  const fetch = async (url: string, init?: any) => {
    const code = decodeURIComponent(/product\/([^?]+)/.exec(url)![1]); log.push(code); const n = (counts.get(code) ?? 0) + 1; counts.set(code, n);
    assert.match(init.headers["User-Agent"], /^RedDeInventario\/1\.0 \(equipo@ejemplo\.com\.ar\)$/);
    const r = await handler(code, n); if (r === "throw") throw new Error("ECONNREFUSED");
    return { status: r.status, headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? r.retry ?? null : null) }, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {})) };
  };
  return { fetch: fetch as any, log };
}
const prod = (code: string, extra: Record<string, unknown> = {}) => ({ status: 200, body: { status: "success", product: { code, product_name: "Galletitas", brands: "Marca A", quantity: "300 g", generic_name: "Galletitas dulces", last_modified_t: 1700000000, countries_tags: [AR], ...extra } } });
const deps = (store: ReturnType<typeof memoryStore>, api: { fetch: any }, c = cfg()) => ({ store, cfg: c, fetch: api.fetch, now: () => clock, sleep: fastSleep, notify: async () => {} });
const sources = { csv: (rows: string[][], extraLines: string[] = []) => csvSource("test.csv", () => (async function* () { yield "code\tlast_modified_t\tproduct_name\tgeneric_name\tquantity\tbrands\tcountries_tags\turl"; for (const r of rows) yield [...r, "x"].join("\t"); for (const l of extraLines) yield l; })()) };
const row = (code: string, t: number, name: string | null = "Producto", brands = "Marca", countries = AR, quantity = "500 g", generic = "") => [code, String(t), name ?? "", generic, quantity, brands, countries];
const plan = (src: ReturnType<typeof csvSource>[], kind: "full" | "delta" = "full", watermark = 1700000500): Plan => ({ kind, label: "prueba", watermark, sources: src });

(async () => {
  console.log("Validación y normalización de GTIN");
  await test("GTIN-8, GTIN-12, GTIN-13 y GTIN-14 válidos se normalizan a 14 dígitos", () => {
    const k = (code: string) => { const n = normalizeRaw({ code, product_name: "X", countries_tags: AR }); assert.ok(n.ok); return n.ok ? [n.rec.gtin_kind, n.rec.gtin14, n.rec.code] : []; };
    assert.deepEqual(k("96385074"), ["GTIN-8", "00000096385074", "96385074"]); assert.deepEqual(k("036000291452"), ["GTIN-12", "00036000291452", "036000291452"]);
    assert.deepEqual(k("7798419930133"), ["GTIN-13", "07798419930133", "7798419930133"]); assert.deepEqual(k("17798419930130"), ["GTIN-14", "17798419930130", "17798419930130"]);
  });
  await test("GTIN inválido, no numérico o vacío se rechaza con su motivo", () => {
    for (const [code, re] of [["7798419930134", /dígito de control/], ["77984199301", /8, 12, 13 o 14/], ["ABC123", /no numérico/], ["", /sin código/]] as const) { const n = normalizeRaw({ code, product_name: "X" }); assert.ok(!n.ok); if (!n.ok) assert.match(n.reason, re); }
  });
  await test("los ceros iniciales se conservan (el GTIN es texto)", () => {
    const n = normalizeRaw({ code: "0012345678905", product_name: "X", countries_tags: AR }); assert.ok(n.ok && n.rec.code === "0012345678905" && n.rec.gtin14 === "00012345678905" && typeof n.rec.code === "string");
  });
  await test("producto con marca pero sin nombre se acepta; sin nombre, genérico ni marca se rechaza; sin marca se acepta", () => {
    const a = normalizeRaw({ code: mk(1), product_name: "", brands: "Marca" }); assert.ok(a.ok && a.rec.product_name === null && displayName(a.rec) === "Marca");
    const b = normalizeRaw({ code: mk(2), product_name: "  ", generic_name: "", brands: "" }); assert.ok(!b.ok);
    const c = normalizeRaw({ code: mk(3), product_name: "Solo nombre" }); assert.ok(c.ok && c.rec.brands === null);
  });
  await test("solo se guardan los campos permitidos y la selección es configurable", () => {
    const raw = { code: mk(4), product_name: "N", generic_name: "G", brands: "B", quantity: "1 l", ingredients_text: "agua", nutriments: { fat: 1 }, image_url: "x" };
    const full = normalizeRaw(raw); assert.ok(full.ok); assert.deepEqual(Object.keys(full.ok ? full.rec : {}).sort(), ["brands", "code", "countries_tags", "generic_name", "gtin14", "gtin_kind", "in_argentina", "off_last_modified_at", "product_name", "quantity"]);
    const some = normalizeRaw(raw, ["product_name", "brands"]); assert.ok(some.ok && some.rec.quantity === null && some.rec.generic_name === null && some.rec.brands === "B");
    assert.deepEqual(configFromEnv({ OFF_FIELDS: "product_name, quantity, invento" }).fields, ["product_name", "quantity"]);
  });
  await test("cantidad y nombre sugerido", () => {
    assert.deepEqual(parseQuantity("500 g"), { value: 500, uom: "GRM", unit: "g" }); assert.deepEqual(parseQuantity("1,5 L"), { value: 1.5, uom: "LTR", unit: "l" }); assert.deepEqual(parseQuantity("6 x 330 ml"), { value: 1980, uom: "MLT", unit: "ml" }); assert.equal(parseQuantity("a gusto"), null);
    assert.equal(suggestedName({ product_name: "Yerba mate", generic_name: null, brands: "Taragüí, Otra", quantity: "500 g" }), "Yerba mate Taragüí 500 g");
  });
  await test("User-Agent descriptivo con contacto válido; sin contacto no se consulta", async () => {
    assert.equal(userAgent(cfg()), "RedDeInventario/1.0 (equipo@ejemplo.com.ar)"); assert.equal(userAgent(configFromEnv({})), null);
    const r = await offLookup({ store: memoryStore(), cfg: configFromEnv({}), now: () => clock }, mk(5)); assert.equal(r.status, "disabled");
  });

  console.log("Consulta bajo demanda (escaneo)");
  await test("producto existente localmente: se devuelve sin consultar a OFF", async () => {
    const s = memoryStore(() => clock); const api = fakeApi(() => prod(mk(10)));
    await s.insertProducts([{ code: mk(10), gtin14: "0" + mk(10), gtin_kind: "GTIN-13", product_name: "Local", generic_name: null, brands: null, quantity: null, countries_tags: [], in_argentina: true, off_last_modified_at: null, origin: "bulk" }]);
    const r = await offLookup(deps(s, api), mk(10)); assert.equal(r.status, "local"); assert.equal(api.log.length, 0);
  });
  await test("no está localmente pero sí en OFF: se consulta, se guarda y la segunda vez es local", async () => {
    const s = memoryStore(() => clock); const api = fakeApi(() => prod(mk(11)));
    const r = await offLookup(deps(s, api), mk(11)); assert.equal(r.status, "found"); assert.equal(api.log.length, 1);
    const p = await s.getProduct("0" + mk(11)); assert.ok(p && p.origin === "on_demand" && p.product_name === "Galletitas" && p.in_argentina === true);
    assert.equal((await offLookup(deps(s, api), mk(11))).status, "local"); assert.equal(api.log.length, 1);
  });
  await test("no existe en OFF: caché negativa (no se vuelve a consultar hasta que vence)", async () => {
    const s = memoryStore(() => clock); const api = fakeApi(() => ({ status: 404, body: { status: "failure", result: { id: "product_not_found" } } }));
    assert.deepEqual(await offLookup(deps(s, api), mk(12)), { status: "not_found", cached: false });
    assert.deepEqual(await offLookup(deps(s, api), mk(12)), { status: "not_found", cached: true }); assert.equal(api.log.length, 1);
    advance(8 * 864e5); assert.equal((await offLookup(deps(s, api), mk(12))).status, "not_found"); assert.equal(api.log.length, 2);
  });
  await test("el 404 y el «product_not_found» con HTTP 200 son «no encontrado»; un GTIN inválido ni se consulta", async () => {
    const s = memoryStore(() => clock); const api = fakeApi(() => ({ status: 200, body: { status: "failure", result: { id: "product_not_found" } } }));
    assert.equal((await offLookup(deps(s, api), mk(13))).status, "not_found");
    const bad = await offLookup(deps(s, api), "7798419930134"); assert.equal(bad.status, "invalid_gtin"); assert.equal(api.log.length, 1);
  });
  await test("OFF no disponible: se informa como error (no como inexistente), no se cachea y el circuito se abre tras fallas seguidas", async () => {
    const s = memoryStore(() => clock); const api = fakeApi(() => "throw"); const alerts: string[] = [];
    const d = { ...deps(s, api), notify: async (k: string) => { alerts.push(k); } };
    for (const n of [20, 21, 22]) { const r = await offLookup(d, mk(n)); assert.equal(r.status, "unavailable"); assert.equal(s.neg.size, 0); }
    assert.deepEqual(alerts, ["api_down"]); const before = api.log.length;
    assert.equal((await offLookup(d, mk(23))).status, "unavailable"); assert.equal(api.log.length, before);   // circuito abierto: ni siquiera se intenta
    assert.equal((await offLookup(d, mk(23), { localOnly: true })).status, "miss");                              // el catálogo local sigue funcionando
    advance(3 * 60_000); assert.equal((await offLookup({ ...d, fetch: fakeApi(() => prod(mk(23))).fetch }, mk(23))).status, "found");   // se recupera sola
  });
  await test("HTTP 429: límite alcanzado, sin cachear, con aviso", async () => {
    const s = memoryStore(() => clock); const api = fakeApi(() => ({ status: 429, retry: "17" })); const alerts: string[] = []; const d = { ...deps(s, api), notify: async (k: string) => { alerts.push(k); } };
    assert.deepEqual(await offLookup(d, mk(30)), { status: "rate_limited", retryAfterS: 17 }); assert.equal(s.neg.size, 0); assert.deepEqual(alerts, ["rate_limited"]); assert.equal(api.log.length, 1);
  });
  await test("el límite propio por minuto se comparte (usa el almacenamiento común)", async () => {
    const s = memoryStore(() => clock); const api = fakeApi((c) => prod(c)); const d = deps(s, api, cfg({ OFF_PRODUCT_RPM: "2" }));
    assert.equal((await offLookup(d, mk(40))).status, "found"); assert.equal((await offLookup(d, mk(41))).status, "found"); assert.equal((await offLookup(d, mk(42))).status, "rate_limited"); assert.equal(api.log.length, 2);
    advance(61_000); assert.equal((await offLookup(d, mk(42))).status, "found");
  });
  await test("reintentos limitados con espera exponencial ante HTTP 503", async () => {
    const s = memoryStore(() => clock); const waits: number[] = []; const api = fakeApi((c, n) => (n < 3 ? { status: 503 } : prod(c)));
    const r = await offLookup({ ...deps(s, api), sleep: async (ms: number) => { waits.push(ms); } }, mk(50)); assert.equal(r.status, "found"); assert.deepEqual(waits, [500, 1000]);
    const api2 = fakeApi(() => ({ status: 503 })); assert.equal((await offLookup(deps(memoryStore(() => clock), api2), mk(51))).status, "unavailable"); assert.equal(api2.log.length, 3);   // 1 + 2 reintentos y se detiene
  });
  await test("respuesta inválida (no JSON o sin producto) no se interpreta como inexistente", async () => {
    const s = memoryStore(() => clock);
    assert.equal((await offLookup(deps(s, fakeApi(() => ({ status: 200, body: "<html>mantenimiento</html>" }))), mk(60))).status, "invalid_response");
    assert.equal((await offLookup(deps(s, fakeApi(() => ({ status: 200, body: { status: "success" } }))), mk(61))).status, "invalid_response"); assert.equal(s.neg.size, 0);
  });
  await test("un UPC-A de 12 dígitos se busca también con el cero adelante", async () => {
    const s = memoryStore(() => clock); const api = fakeApi((c) => (c.length === 12 ? { status: 404 } : prod(c)));
    const r = await offLookup(deps(s, api), "036000291452"); assert.equal(r.status, "found"); assert.deepEqual(api.log, ["036000291452", "0036000291452"]);
  });
  await test("producto en OFF sin ningún dato descriptivo: se trata como sin datos y se recuerda por poco tiempo", async () => {
    const s = memoryStore(() => clock); const api = fakeApi((c) => prod(c, { product_name: "", brands: "", generic_name: "" }));
    assert.equal((await offLookup(deps(s, api), mk(70))).status, "not_found"); advance(2 * 864e5); assert.equal((await offLookup(deps(s, api), mk(70))).status, "not_found"); assert.equal(api.log.length, 2);
  });
  await test("consultas concurrentes del mismo GTIN: una sola consulta externa", async () => {
    const s = memoryStore(() => clock); let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const api = fakeApi(async (c) => { await gate; return prod(c); });
    const d = { ...deps(s, api), sleep: () => new Promise((r) => setTimeout(r, 2)) };
    const all = Promise.all([1, 2, 3, 4, 5].map(() => offLookup(d, mk(80)))); await new Promise((r) => setTimeout(r, 15)); release();
    const res = await all; assert.equal(api.log.length, 1); assert.ok(res.every((r) => r.status === "found" || r.status === "local")); assert.equal(res.filter((r) => r.status === "found").length, 1);
  });

  console.log("Lectura de exportaciones");
  await test("CSV: solo Argentina, tabuladores, BOM y CRLF; filas con formato inesperado se cuentan aparte", async () => {
    const lines = ["\uFEFFcode\tlast_modified_t\tproduct_name\tgeneric_name\tquantity\tbrands\tcountries_tags\totra\r", `${mk(1)}\t1\tA\t\t1 l\tM\ten:argentina,en:chile\tx\r`, `${mk(2)}\t1\tB\t\t1 l\tM\ten:france\tx\r`, `${mk(3)}\t1\tC\t\t\tM\ten:argentinaa\tx\r`, "fila rota\tsin columnas"];
    const src = csvSource("t", () => (async function* () { yield* lines; })()); const out: any[] = []; for await (const i of src.iterate()) out.push(i);
    assert.equal(out.length, 2); assert.equal(out[0].raw.code, mk(1)); assert.equal(out[1].malformed, "fila con 2 columnas en lugar de 8"); assert.equal(src.stats().read, 4);
  });
  await test("CSV: si faltan columnas se aborta con un mensaje claro", async () => {
    const src = csvSource("t", () => (async function* () { yield "code\tproduct_name"; yield "1\tx"; })());
    await assert.rejects(async () => { for await (const _ of src.iterate()) { /* */ } }, (e: any) => e instanceof FormatError && /last_modified_t, generic_name/.test(e.message));
  });
  await test("archivos delta: índice, plan y lectura JSON por líneas", async () => {
    const files = parseDeltaIndex("openfoodfacts_products_1700000000_1700086399.json.gz\nopenfoodfacts_products_1700086400_1700172799.json.gz\nbasura.txt\n", "https://x/delta/");
    assert.equal(files.length, 2); assert.equal(files[0].url, "https://x/delta/openfoodfacts_products_1700000000_1700086399.json.gz");
    assert.deepEqual(planDelta(files, 1700086399).files.map((f) => f.to), [1700172799]); assert.deepEqual(planDelta(files, 1700172799), { needFull: false, files: [] });
    assert.equal(planDelta(files, 1600000000).needFull, true); assert.equal(planDelta(files, null).needFull, true); assert.equal(planDelta([], 1700000000).needFull, true);
    const src = jsonlSource("d", () => (async function* () { yield JSON.stringify({ code: mk(1), last_modified_t: 5, product_name: "A", countries_tags: ["en:argentina"], nutriments: {} }); yield JSON.stringify({ code: mk(2), countries_tags: ["en:spain"] }); yield "{roto"; yield ""; })());
    const out: any[] = []; for await (const i of src.iterate()) out.push(i); assert.equal(out.length, 1);
  });

  await test("archivo delta con formato inesperado: falla de forma explícita en vez de «completarse» sin procesar nada", async () => {
    const src = jsonlSource("raro", () => (async function* () { for (let i = 0; i < 60; i++) yield `[{"otro":${i}}]`; })());
    await assert.rejects(async () => { for await (const _ of src.iterate()) { /* */ } }, (e: any) => e instanceof FormatError && /formato esperado/.test(e.message));
  });

  console.log("Importación y sincronización");
  await test("importación completa: inserta, rechaza inválidos, cuenta y marca la ejecución como completada", async () => {
    const s = memoryStore(() => clock); const d = deps(s, { fetch: null });
    const run = await syncOnce(d, plan([sources.csv([row(mk(1), 100), row(mk(2), 100), row("7798419930134", 100), row(mk(3), 100, null, ""), row(mk(4), 100, "Sin marca", "")])]));
    assert.equal(run.status, "completed"); assert.deepEqual([run.processed, run.inserted, run.updated, run.unchanged, run.rejected], [5, 3, 0, 0, 2]); assert.equal(s.products.size, 3); assert.ok(run.finished_at && run.watermark_t === 1700000500);
    assert.equal(s.issues.length, 2); assert.ok([...s.products.values()].every((p) => p.last_seen_run === run.id && p.first_run === run.id && p.origin === "bulk" && p.in_argentina));
  });
  await test("duplicados dentro del archivo y contra lo existente: un solo registro (el más reciente)", async () => {
    const s = memoryStore(() => clock); const d = deps(s, { fetch: null });
    const run = await syncOnce(d, plan([sources.csv([row(mk(1), 100, "Viejo"), row(mk(1), 300, "Nuevo"), row(mk(1), 200, "Medio"), row(mk(2), 50)])]));
    assert.equal(s.products.size, 2); assert.equal(s.products.get("0" + mk(1))!.product_name, "Nuevo"); assert.equal(run.inserted, 2); assert.equal(run.unchanged, 2);
  });
  await test("reejecutar la misma importación no duplica ni modifica: todo queda «sin cambios»", async () => {
    const s = memoryStore(() => clock); const d = deps(s, { fetch: null }); const rows = [row(mk(1), 100), row(mk(2), 100), row(mk(3), 100)];
    await syncOnce(d, plan([sources.csv(rows)])); advance(86_400_000);
    const again = await syncOnce(d, plan([sources.csv(rows)])); assert.deepEqual([again.inserted, again.updated, again.unchanged], [0, 0, 3]); assert.equal(s.products.size, 3);
    assert.ok([...s.products.values()].every((p) => p.last_seen_run === again.id));
  });
  await test("producto modificado se actualiza; con fecha más vieja no se pisa", async () => {
    const s = memoryStore(() => clock); const d = deps(s, { fetch: null });
    await syncOnce(d, plan([sources.csv([row(mk(1), 100, "Original"), row(mk(2), 100, "Dos")])]));
    const run = await syncOnce(d, plan([sources.csv([row(mk(1), 200, "Modificado"), row(mk(2), 50, "Viejo")])]));
    assert.deepEqual([run.updated, run.unchanged], [1, 1]); assert.equal(s.products.get("0" + mk(1))!.product_name, "Modificado"); assert.equal(s.products.get("0" + mk(2))!.product_name, "Dos");
    assert.equal(s.products.get("0" + mk(1))!.first_run, s.runs[0].id);   // la primera importación se conserva
  });
  await test("un producto que desaparece de la exportación se conserva (nunca se borra)", async () => {
    const s = memoryStore(() => clock); const d = deps(s, { fetch: null });
    const r1 = await syncOnce(d, plan([sources.csv([row(mk(1), 100), row(mk(2), 100)])])); advance(86_400_000);
    const r2 = await syncOnce(d, plan([sources.csv([row(mk(1), 100)])]));
    assert.equal(s.products.size, 2); assert.equal(s.products.get("0" + mk(2))!.last_seen_run, r1.id); assert.equal(s.products.get("0" + mk(1))!.last_seen_run, r2.id);
  });
  await test("importación interrumpida: queda registrada, y al repetirla se reanuda sin duplicar ni contar dos veces", async () => {
    const s = memoryStore(() => clock); const d = deps(s, { fetch: null }); const rows = [1, 2, 3, 4, 5, 6].map((n) => row(mk(n), 100 + n));
    let broken = true;
    const src = () => csvSource("t.csv", () => (async function* () { yield "code\tlast_modified_t\tproduct_name\tgeneric_name\tquantity\tbrands\tcountries_tags"; let i = 0; for (const r of rows) { if (broken && i++ === 4) throw new Error("se cortó la descarga"); yield r.join("\t"); } })());
    await assert.rejects(() => syncOnce(d, plan([src()])), /se cortó/);
    const failed = s.runs[0]; assert.equal(failed.status, "failed"); assert.ok(failed.cursor && failed.cursor.line! > 1); assert.equal(failed.inserted, 4); assert.ok(s.alerts.some((a) => a.kind === "import_failed"));
    broken = false; const done = await syncOnce(d, plan([src()]));
    assert.equal(s.runs.length, 1); assert.equal(done.id, failed.id); assert.equal(done.status, "completed"); assert.deepEqual([done.processed, done.inserted], [6, 6]); assert.equal(s.products.size, 6);
  });
  await test("no se ejecutan dos sincronizaciones a la vez; una abandonada se marca como interrumpida", async () => {
    const s = memoryStore(() => clock); const d = deps(s, { fetch: null }); let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const slow = csvSource("t", () => (async function* () { yield "code\tlast_modified_t\tproduct_name\tgeneric_name\tquantity\tbrands\tcountries_tags"; await gate; yield row(mk(1), 1).join("\t"); })());
    const first = syncOnce(d, plan([slow])); await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(() => syncOnce(d, plan([sources.csv([row(mk(2), 1)])])), SyncBusyError); release(); await first;
    const s2 = memoryStore(() => clock); await s2.createRun({ kind: "full", source_label: "x", source_url: null }); advance(31 * 60_000);
    const run = await syncOnce(deps(s2, { fetch: null }), plan([sources.csv([row(mk(3), 1)])])); assert.equal(run.status, "completed"); assert.equal(s2.runs.find((r) => r.id !== run.id)!.status, "interrupted");
  });
  await test("sincronización diaria por archivos delta: aplica solo los cambios y avanza la marca de tiempo", async () => {
    const s = memoryStore(() => clock); const d = deps(s, { fetch: null });
    await syncOnce(d, plan([sources.csv([row(mk(1), 100, "Uno"), row(mk(2), 100, "Dos")])], "full", 1700000000));
    const delta = jsonlSource("delta1.json", () => (async function* () { yield JSON.stringify({ code: mk(1), last_modified_t: 1700000100, product_name: "Uno (cambiado)", countries_tags: [AR] }); yield JSON.stringify({ code: mk(9), last_modified_t: 1700000200, product_name: "Nuevo", countries_tags: [AR] }); yield JSON.stringify({ code: mk(8), last_modified_t: 1700000200, product_name: "Otro país", countries_tags: ["en:chile"] }); })(), { to: 1700086399 });
    const run = await syncOnce(d, { kind: "delta", label: "delta", watermark: 1700086399, sources: [delta] });
    assert.equal(run.status, "completed"); assert.deepEqual([run.inserted, run.updated, run.unchanged], [1, 1, 0]); assert.equal(s.products.size, 3); assert.equal(s.products.get("0" + mk(1))!.origin, "delta"); assert.equal(s.products.has("0" + mk(8)), false);
  });
  await test("decisión diaria: completa la primera vez, cada tanto o si los delta no alcanzan; si no, solo cambios", () => {
    const c = cfg(), day = 864e5, run = (daysAgo: number, wm: number | null) => ({ started_at: new Date(clock - daysAgo * day).toISOString(), watermark_t: wm } as any);
    assert.equal(decideMode({ completed: null, fullCompleted: null }, clock, c).mode, "full");
    assert.equal(decideMode({ completed: run(1, clock / 1000 - 86400), fullCompleted: run(5, 1) }, clock, c).mode, "delta");
    assert.equal(decideMode({ completed: run(1, clock / 1000 - 86400), fullCompleted: run(40, 1) }, clock, c).mode, "full");
    assert.equal(decideMode({ completed: run(1, clock / 1000 - 15 * 86400), fullCompleted: run(5, 1) }, clock, c).mode, "full");
  });
  await test("alertas: archivo sin productos de Argentina, caída anormal y exceso de rechazados", async () => {
    const s = memoryStore(() => clock); const d = deps(s, { fetch: null }, cfg({ OFF_BATCH_SIZE: "50" }));
    await assert.rejects(() => syncOnce(d, plan([sources.csv([row(mk(1), 1, "X", "M", "en:france")])])), /ningún producto de Argentina/); assert.equal(s.runs[0].status, "failed"); assert.ok(s.alerts.some((a) => a.kind === "import_failed"));
    const s2 = memoryStore(() => clock); const d2 = deps(s2, { fetch: null }, cfg({ OFF_BATCH_SIZE: "50" }));
    const many = (n: number, bad = 0) => Array.from({ length: n }, (_, i) => row(i < bad ? "123" : mk(i + 1), 100));
    await syncOnce(d2, plan([sources.csv(many(120))])); advance(864e5);
    await syncOnce(d2, plan([sources.csv(many(60))])); assert.ok(s2.alerts.some((a) => a.kind === "count_drop"));
    const s3 = memoryStore(() => clock); await syncOnce(deps(s3, { fetch: null }, cfg({ OFF_BATCH_SIZE: "50" })), plan([sources.csv(many(120, 30))])); assert.ok(s3.alerts.some((a) => a.kind === "validation_errors"));
  });

  console.log(`\n${passed} pruebas correctas${process.exitCode ? " — HAY FALLAS" : ""}`);
})();
