import assert from "node:assert/strict";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { gtin13 } from "../lib/gs1/keys";
import { configFromEnv } from "../lib/off/config";
import { csvSource, jsonlSource, parseDeltaIndex, planDelta } from "../lib/off/export";
import { openLines } from "../lib/off/stream";
import { syncOnce } from "../lib/off/sync";
import { memoryStore } from "./memoryStore";
// Prueba de la descarga real por HTTP (streaming + gzip + filtrado), con un servidor local que imita las exportaciones de Open Food Facts.
// Ejecutar: npx tsx tests/stream.test.ts
let passed = 0;
const test = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log("  ✔", name); } catch (e: any) { console.error("  ✖", name, "\n   ", e?.message ?? e); process.exitCode = 1; } };
const mk = (n: number) => gtin13("7791234", n), HEAD = "code\turl\tlast_modified_t\tproduct_name\tgeneric_name\tquantity\tbrands\tcountries_tags\tingredients_text";
const csv = (n: number) => [HEAD, ...Array.from({ length: n }, (_, i) => [mk(i + 1), "u", 1700000000 + i, `Producto ${i + 1}`, "", "500 g", "Marca", i % 3 === 0 ? "en:france" : "en:argentina,en:chile", "agua, sal"].join("\t"))].join("\n") + "\n";
const cfg = configFromEnv({ OFF_CONTACT_EMAIL: "equipo@ejemplo.com.ar", OFF_BATCH_SIZE: "50" });
const UA = "RedDeInventario/1.0 (equipo@ejemplo.com.ar)";

(async () => {
  const gz = gzipSync(Buffer.from(csv(300))), seen: string[] = []; let truncate = false;
  const delta = gzipSync(Buffer.from([JSON.stringify({ code: mk(2), last_modified_t: 1800000000, product_name: "Producto 2 (cambiado)", countries_tags: ["en:argentina"], nutriments: { a: 1 } }), JSON.stringify({ code: mk(999), last_modified_t: 1800000001, product_name: "Nuevo", brands: "X", countries_tags: ["en:argentina"] }), JSON.stringify({ code: mk(998), product_name: "Chile", countries_tags: ["en:chile"] })].join("\n") + "\n"));
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers["user-agent"]}`);
    if (req.url === "/data.csv.gz") { res.writeHead(200, { "Content-Type": "application/gzip", "Content-Length": gz.length, "Last-Modified": "Fri, 06 Nov 2026 03:00:00 GMT" }); if (req.method === "HEAD") return res.end(); if (truncate) { res.write(gz.subarray(0, Math.floor(gz.length / 2))); return setTimeout(() => res.destroy(), 20); } return res.end(gz); }
    if (req.url === "/delta/index.txt") { res.writeHead(200); return res.end("openfoodfacts_products_1799900000_1800000100.json.gz\n"); }
    if (req.url?.startsWith("/delta/openfoodfacts_products_")) { res.writeHead(200, { "Content-Type": "application/gzip" }); return res.end(delta); }
    res.writeHead(404); res.end("no existe");
  }).listen(0); await new Promise((r) => server.once("listening", r)); const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const csvPlan = () => ({ kind: "full" as const, label: "csv", watermark: 1700000000, sources: [csvSource("csv", () => (async function* () { yield* (await openLines(`${base}/data.csv.gz`, UA)).lines; })(), { file: "csv" })] });
  try {
    await test("descarga el CSV comprimido en streaming, filtra Argentina y guarda solo los campos permitidos", async () => {
      const s = memoryStore(); const run = await syncOnce({ store: s, cfg }, csvPlan());
      assert.equal(run.status, "completed"); assert.equal(run.processed, 200); assert.equal(run.inserted, 200); assert.equal(s.products.size, 200); assert.equal(run.rows_read, 300);
      const p = s.products.get("0" + mk(2))!; assert.deepEqual([p.product_name, p.quantity, p.brands, p.countries_tags], ["Producto 2", "500 g", "Marca", ["en:argentina", "en:chile"]]); assert.equal("ingredients_text" in p, false);
      assert.ok(!s.products.has("0" + mk(1)));   // el 1.º es de Francia
      assert.ok(seen.every((x) => x.endsWith(UA)));  // se identifica con un User-Agent descriptivo
    });
    await test("una descarga cortada a la mitad deja la ejecución como fallida y la repetición la completa sin duplicar", async () => {
      const s = memoryStore(); truncate = true;
      await assert.rejects(() => syncOnce({ store: s, cfg }, csvPlan()));
      const failed = s.runs[0]; assert.equal(failed.status, "failed"); assert.ok(failed.inserted > 0 && failed.inserted < 200); assert.ok(s.alerts.some((a) => a.kind === "import_failed"));
      truncate = false; const done = await syncOnce({ store: s, cfg }, csvPlan());
      assert.equal(done.id, failed.id); assert.equal(done.status, "completed"); assert.equal(done.inserted, 200); assert.equal(s.products.size, 200);
    });
    await test("un archivo que no existe da un error claro", async () => {
      await assert.rejects(() => openLines(`${base}/nada.csv.gz`, UA), /No se pudo descargar .*HTTP 404/);
    });
    await test("cambios diarios: índice delta + archivo JSON comprimido, solo Argentina", async () => {
      const s = memoryStore(); await syncOnce({ store: s, cfg }, csvPlan());
      const files = parseDeltaIndex(await (await fetch(`${base}/delta/index.txt`)).text(), `${base}/delta/`), p = planDelta(files, 1799950000);
      assert.equal(p.needFull, false); assert.equal(p.files.length, 1);
      const sources = p.files.map((f) => jsonlSource(f.name, () => (async function* () { yield* (await openLines(f.url, UA)).lines; })(), { file: f.name, to: f.to }));
      const run = await syncOnce({ store: s, cfg }, { kind: "delta", label: "delta", watermark: p.files[0].to, sources });
      assert.deepEqual([run.inserted, run.updated, run.unchanged, run.rejected], [1, 1, 0, 0]); assert.equal(s.products.get("0" + mk(2))!.product_name, "Producto 2 (cambiado)");
      assert.equal(s.products.get("0" + mk(999))!.product_name, "Nuevo"); assert.equal(s.products.has("0" + mk(998)), false); assert.equal(planDelta(files, 1800000100).files.length, 0);
    });
  } finally { server.close(); }
  console.log(`\n${passed} pruebas correctas${process.exitCode ? " — HAY FALLAS" : ""}`);
})();
