import { CODE128 } from "./barcode_patterns";
import { checkDigit, isDigits, validCheck } from "./check";
// Codificadores de códigos de barras GS1 lineales (EAN-13, EAN-8, UPC-A, ITF-14, Code 128 / GS1-128) y dibujo en SVG.
export type Linear = { modules: string; quiet: [number, number]; hri: string; type: string; guards?: number[] };

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
function requireCode(code: string, len: number[], label: string) {
  if (!isDigits(code) || !len.includes(code.length)) throw new Error(`${label} lleva ${len.join(" o ")} dígitos`);
  if (!validCheck(code)) throw new Error(`${label}: el dígito de control no coincide (debería ser ${checkDigit(code.slice(0, -1))})`);
}
export function ean13(code: string): Linear {
  requireCode(code, [13], "EAN-13");
  const par = PARITY[Number(code[0])];
  let m = "101";
  for (let i = 0; i < 6; i++) m += (par[i] === "L" ? L : G)[Number(code[1 + i])];
  m += "01010";
  for (let i = 0; i < 6; i++) m += R[Number(code[7 + i])];
  return { modules: m + "101", quiet: [11, 7], hri: code, type: "ean13" };
}
export function upca(code: string): Linear {
  requireCode(code, [12], "UPC-A");
  const e = ean13("0" + code);
  return { ...e, hri: code, type: "upca" };
}
export function ean8(code: string): Linear {
  requireCode(code, [8], "EAN-8");
  let m = "101";
  for (let i = 0; i < 4; i++) m += L[Number(code[i])];
  m += "01010";
  for (let i = 4; i < 8; i++) m += R[Number(code[i])];
  return { modules: m + "101", quiet: [7, 7], hri: code, type: "ean8" };
}
// Interleaved 2 of 5 (ITF-14): pares de dígitos, la primera cifra va en las barras y la segunda en los espacios.
const ITF = ["nnwwn", "wnnnw", "nwnnw", "wwnnn", "nnwnw", "wnwnn", "nwwnn", "nnnww", "wnnwn", "nwnwn"];
export function itf14(code: string): Linear {
  requireCode(code, [14], "ITF-14");
  let m = "1010";
  for (let i = 0; i < 14; i += 2) {
    const a = ITF[Number(code[i])], b = ITF[Number(code[i + 1])];
    for (let k = 0; k < 5; k++) { m += "1".repeat(a[k] === "w" ? 3 : 1); m += "0".repeat(b[k] === "w" ? 3 : 1); }
  }
  return { modules: m + "11101", quiet: [10, 10], hri: code, type: "itf14" };
}

// ---- Code 128 / GS1-128 ----
export const FNC1 = "\u00f1";            // marcador interno de FNC1 dentro de la cadena a codificar
type Mode = "A" | "B" | "C";
/** Código 128 con la menor cantidad de símbolos posible (programación dinámica entre juegos A, B y C). */
export function code128Values(data: string, gs1 = false): number[] {
  const toks = Array.from(data); const n = toks.length;
  const okA = (c: string) => c === FNC1 || (c.charCodeAt(0) <= 95), okB = (c: string) => c === FNC1 || (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 127);
  const val = (c: string, m: Mode) => (c === FNC1 ? 102 : m === "A" ? (c.charCodeAt(0) < 32 ? c.charCodeAt(0) + 64 : c.charCodeAt(0) - 32) : c.charCodeAt(0) - 32);
  for (const c of toks) if (c !== FNC1 && c.charCodeAt(0) > 127) throw new Error("Code 128 solo admite caracteres ASCII");
  const INF = 1e9, MODES: Mode[] = ["A", "B", "C"];
  type Cell = { cost: number; prev?: [number, Mode]; emit: number[] };
  const dp: Record<Mode, Cell>[] = Array.from({ length: n + 1 }, () => ({ A: { cost: INF, emit: [] }, B: { cost: INF, emit: [] }, C: { cost: INF, emit: [] } }));
  const START: Record<Mode, number> = { A: 103, B: 104, C: 105 }, SW: Record<Mode, number> = { A: 101, B: 100, C: 99 };
  const lead = gs1 ? 1 : 0;           // en GS1-128 el FNC1 inicial va justo después del símbolo de inicio
  for (const m of MODES) dp[0][m] = { cost: 1 + lead, emit: [START[m], ...(gs1 ? [102] : [])] };
  for (let i = 0; i < n; i++) for (const m of MODES) {
    const cur = dp[i][m]; if (cur.cost >= INF) continue;
    for (const t of MODES) {          // cambio de juego (cuesta un símbolo) o permanecer
      const base = t === m ? cur.cost : cur.cost + 1, pre = t === m ? [] : [SW[t]];
      let consumed = 0, emit: number[] | null = null;
      if (t === "C") { if (isDigits(toks[i] ?? "x") && isDigits(toks[i + 1] ?? "x")) { consumed = 2; emit = [Number(toks[i] + toks[i + 1])]; } else if (toks[i] === FNC1) { consumed = 1; emit = [102]; } }
      else if (toks[i] !== undefined && (t === "A" ? okA(toks[i]) : okB(toks[i]))) { consumed = 1; emit = [val(toks[i], t)]; }
      if (!emit) continue;
      const nxt = dp[i + consumed][t], cost = base + 1;
      if (cost < nxt.cost) dp[i + consumed][t] = { cost, prev: [i, m], emit: [...pre, ...emit] };
    }
  }
  let best: Mode = "A"; for (const m of MODES) if (dp[n][m].cost < dp[n][best].cost) best = m;
  if (dp[n][best].cost >= INF) throw new Error("No se pudo codificar el contenido en Code 128");
  const out: number[][] = []; let i = n, m: Mode = best;
  while (true) { const c = dp[i][m]; out.unshift(c.emit); if (!c.prev) break; [i, m] = c.prev; }
  return out.flat();
}
export function code128(data: string, gs1 = false, hri?: string): Linear {
  const v = code128Values(data, gs1); let sum = v[0];
  for (let i = 1; i < v.length; i++) sum += i * v[i];
  const all = [...v, sum % 103, 106];
  let m = "", bar = true;
  for (const val of all) for (const ch of CODE128[val]) { m += (bar ? "1" : "0").repeat(Number(ch)); bar = !bar; }
  return { modules: m, quiet: [10, 10], hri: hri ?? data.split(FNC1).join(""), type: gs1 ? "gs1-128" : "code128" };
}
/** GS1-128 a partir de la cadena cruda (con GS 0x1D entre campos variables): cada GS pasa a ser un FNC1. */
export const gs1_128 = (raw: string, hri: string) => code128(raw.replace(/\x1d/g, FNC1), true, hri);

// ---- Dibujo SVG ----
export type SvgOptions = { xDimMm?: number; heightMm?: number; text?: boolean; color?: string; background?: string };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Dibuja el código en SVG con medidas reales: el ancho del módulo (X) está en milímetros para imprimir a escala. */
export function toSvg(b: Linear, o: SvgOptions = {}): string {
  const x = o.xDimMm ?? (b.type === "itf14" || b.type === "gs1-128" ? 0.495 : 0.33);
  const hMm = o.heightMm ?? (b.type === "ean8" ? 18.2 : b.type === "ean13" || b.type === "upca" ? 22.85 : 25), withText = o.text !== false;
  const fg = o.color ?? "#000", bg = o.background ?? "#fff";
  const isEan = b.type === "ean13" || b.type === "upca" || b.type === "ean8";
  const W = b.quiet[0] + b.modules.length + b.quiet[1], bearer = b.type === "itf14" ? 4 : 0;       // el ITF-14 lleva marco («bearer bars»)
  const barH = hMm / x - (withText ? 5 : 0) - 2 * bearer, textH = withText ? 5 : 0, totalW = W + 2 * bearer, H = barH + textH + 2 * bearer;
  const g = guardPositions(b), y0 = bearer;
  let rects = "", i = 0;
  while (i < b.modules.length) {
    if (b.modules[i] === "1") { let j = i; while (b.modules[j] === "1") j++; const guard = g.has(i) || g.has(j - 1); rects += `<rect x="${bearer + b.quiet[0] + i}" y="${y0}" width="${j - i}" height="${guard && withText ? barH + 2 : barH}"/>`; i = j; } else i++;
  }
  let text = "";
  if (withText) {
    const ty = y0 + barH + 4.2, fs = !isEan && b.hri.length > 40 ? 2.8 : 3.8, f = `font-family="OCR-B, 'Courier New', monospace" font-size="${fs}" text-anchor="middle" fill="${fg}"`;
    if (b.type === "ean13") { const d = b.hri, ox = bearer + b.quiet[0]; text = `<text x="${ox - 4}" y="${ty}" ${f}>${d[0]}</text><text x="${ox + 3 + 21}" y="${ty}" ${f} textLength="38">${d.slice(1, 7)}</text><text x="${ox + 50 + 21}" y="${ty}" ${f} textLength="38">${d.slice(7)}</text>`; }
    else if (b.type === "upca") { const d = b.hri, ox = bearer + b.quiet[0]; text = `<text x="${ox - 4}" y="${ty}" ${f}>${d[0]}</text><text x="${ox + 3 + 21}" y="${ty}" ${f} textLength="33">${d.slice(1, 6)}</text><text x="${ox + 50 + 21}" y="${ty}" ${f} textLength="33">${d.slice(6, 11)}</text><text x="${ox + 95 + 4}" y="${ty}" ${f}>${d[11]}</text>`; }
    else if (b.type === "ean8") { const d = b.hri, ox = bearer + b.quiet[0]; text = `<text x="${ox + 3 + 14}" y="${ty}" ${f} textLength="26">${d.slice(0, 4)}</text><text x="${ox + 36 + 14}" y="${ty}" ${f} textLength="26">${d.slice(4)}</text>`; }
    else text = `<text x="${totalW / 2}" y="${ty}" ${f}>${esc(b.hri)}</text>`;
  }
  let frame = "";
  if (bearer) frame = `<rect x="${bearer / 2}" y="${bearer / 2}" width="${totalW - bearer}" height="${H - bearer}" fill="none" stroke="${fg}" stroke-width="${bearer}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${H}" width="${(totalW * x).toFixed(2)}mm" height="${(H * x).toFixed(2)}mm" role="img" aria-label="${esc(b.type)} ${esc(b.hri)}" shape-rendering="crispEdges"><rect width="${totalW}" height="${H}" fill="${bg}"/><g fill="${fg}">${rects}</g>${frame}${text}</svg>`;
}
function guardPositions(b: Linear): Set<number> {
  const n = b.modules.length, s = new Set<number>();
  if (b.type === "ean13" || b.type === "upca" || b.type === "ean8") { for (const p of [0, 2, Math.floor(n / 2) - 2, Math.floor(n / 2), n - 3, n - 1]) s.add(p); s.add(Math.floor(n / 2) - 1); }
  return s;
}
