import { redirect } from "next/navigation";
import type { SP } from "@/components/Shell";
// Las pantallas viejas (/products, /orders…) ahora son submenús de Inventario o Red; estas rutas redirigen para no romper enlaces ni QR impresos.
export async function legacy(base: string, patch: Record<string, string>, sp: SP): Promise<never> {
  const cur = await sp;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(cur)) if (v && ["e", "ok", "lot", "q"].includes(k)) q.set(k, v);
  for (const [k, v] of Object.entries(patch)) q.set(k, v);
  redirect(`${base}?${q.toString()}`);
}
