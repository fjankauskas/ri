// Lectura mínima de XML/SOAP para los campos conocidos de WSAA y WSFE (sin dependencias).
export const esc = (s: string | number) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const NS = "(?:[A-Za-z0-9_-]+:)?";
/** Contenido del primer <tag>…</tag> (ignora prefijos de namespace). */
export function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${NS}${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${NS}${name}>`).exec(xml);
  return m ? m[1] : null;
}
/** Contenido de todos los <tag>…</tag>. */
export function all(xml: string, name: string): string[] {
  const re = new RegExp(`<${NS}${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${NS}${name}>`, "g"), out: string[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]);
  return out;
}
export const text = (xml: string, name: string) => { const v = tag(xml, name); return v == null ? null : unesc(v.trim()); };
