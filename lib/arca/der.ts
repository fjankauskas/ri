// Utilidades mínimas de codificación/lectura DER (ASN.1). Solo lo necesario para armar el CMS de WSAA y el CSR.
export const B = (...a: number[]) => Buffer.from(a);
const len = (n: number) => (n < 128 ? B(n) : n < 256 ? B(0x81, n) : n < 65536 ? B(0x82, n >> 8, n & 255) : B(0x83, n >> 16, (n >> 8) & 255, n & 255));
export const tlv = (tag: number, ...parts: Buffer[]) => { const body = Buffer.concat(parts); return Buffer.concat([B(tag), len(body.length), body]); };
export const seq = (...p: Buffer[]) => tlv(0x30, ...p);
export const set = (...p: Buffer[]) => tlv(0x31, ...p);
export const oct = (b: Buffer) => tlv(0x04, b);
export const nul = () => B(0x05, 0x00);
export const int = (n: number) => tlv(0x02, B(n));
export const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
export const printable = (s: string) => tlv(0x13, Buffer.from(s, "ascii"));
export const bitString = (b: Buffer) => tlv(0x03, B(0x00), b);
/** [n] explícito/implícito constructed (A0..): contenido ya codificado. */
export const ctx = (n: number, ...p: Buffer[]) => tlv(0xa0 | n, ...p);
export function oid(dotted: string) {
  const a = dotted.split(".").map(Number);
  const out: number[] = [a[0] * 40 + a[1]];
  for (const n of a.slice(2)) { const s: number[] = [n & 0x7f]; let v = n >> 7; while (v > 0) { s.unshift((v & 0x7f) | 0x80); v >>= 7; } out.push(...s); }
  return tlv(0x06, Buffer.from(out));
}
export function utcTime(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return tlv(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, "ascii"));
}
/** Lee un TLV en `pos`. Devuelve tag, rango del contenido y fin del elemento. */
export function read(buf: Buffer, pos: number) {
  const tag = buf[pos]; let l = buf[pos + 1], h = 2;
  if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) l = (l << 8) | buf[pos + 2 + i]; h = 2 + n; }
  return { tag, start: pos, body: pos + h, end: pos + h + l };
}
/** Hijos (como TLV completos) de un elemento constructed. */
export function children(buf: Buffer, el: { body: number; end: number }) {
  const out: { tag: number; raw: Buffer }[] = []; let p = el.body;
  while (p < el.end) { const c = read(buf, p); out.push({ tag: c.tag, raw: buf.subarray(c.start, c.end) }); p = c.end; }
  return out;
}
