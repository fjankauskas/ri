import { createGunzip } from "node:zlib";
import { pipeline, Readable } from "node:stream";
// Descarga y lectura en streaming (sin cargar el archivo en memoria ni en disco). Solo para el script de sincronización.
/** Parte un flujo de bytes en líneas. Si la conexión se corta, el error llega al consumidor (no se pierde ni tumba el proceso). */
export async function* splitLines(stream: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const dec = new TextDecoder("utf-8"); let tail = "";
  for await (const chunk of stream) {
    tail += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
    let start = 0, i: number;
    while ((i = tail.indexOf("\n", start)) >= 0) { yield tail.slice(start, i); start = i + 1; }
    tail = tail.slice(start);
  }
  tail += dec.decode(); if (tail) yield tail;
}
export async function openLines(url: string, ua: string, f: typeof fetch = fetch): Promise<{ lines: AsyncIterable<string>; lastModified: number | null; bytes: number | null }> {
  const res = await f(url, { headers: { "User-Agent": ua, "Accept-Encoding": "identity" } });
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${url} (HTTP ${res.status}).`);
  const source = Readable.fromWeb(res.body as any);
  const bytes: AsyncIterable<Uint8Array> = /\.gz(\?|$)/.test(url) ? pipeline(source, createGunzip(), () => { /* los errores se entregan por la iteración */ }) : source;
  const lm = Date.parse(res.headers.get("last-modified") ?? ""), len = Number(res.headers.get("content-length"));
  return { lines: splitLines(bytes), lastModified: Number.isFinite(lm) ? Math.floor(lm / 1000) : null, bytes: Number.isFinite(len) && len > 0 ? len : null };
}
