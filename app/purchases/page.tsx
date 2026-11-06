import { redirect } from "next/navigation";
import type { SP } from "@/components/Shell";
// Esta pantalla ahora está dentro de «Compras y ventas»: se conservan los enlaces viejos.
const MAP: Record<string, string> = { orders: "purchases", suppliers: "suppliers", invoices: "invoices", prices: "prices" };
export default async function PurchasesLegacy({ searchParams }: { searchParams: SP }) {
  const P = await searchParams, q = new URLSearchParams();
  for (const [k, v] of Object.entries(P)) if (v && k !== "v" && k !== "inv") q.set(k, v);
  const view = MAP[P.v ?? "orders"] ?? "purchases";
  q.set("v", view);
  if (view === "invoices") { q.set("dir", "in"); if (P.inv) q.set("i", `in:${P.inv}`); }
  redirect("/commerce?" + q.toString());
}
