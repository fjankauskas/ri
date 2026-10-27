export type Params = Record<string, string | undefined>;
/** Arma una URL a partir de los parámetros actuales más los cambios (null/"" los quita). Nunca arrastra los avisos e/ok. */
export function mk(base: string, cur: Params, patch: Record<string, string | null | undefined> = {}) {
  const all: Record<string, string | null | undefined> = { ...cur, ...patch };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(all)) if (v && k !== "e" && k !== "ok") q.set(k, v);
  const s = q.toString();
  return base + (s ? "?" + s : "");
}
