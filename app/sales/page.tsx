import { redirect } from "next/navigation";
import type { SP } from "@/components/Shell";
// Esta pantalla ahora está dentro de «Compras y ventas»: se conservan los enlaces viejos.
const MAP: Record<string, string> = { sales: "sales", customers: "customers", invoices: "invoices", arca: "arca" };
export default async function SalesLegacy({ searchParams }: { searchParams: SP }) {
  const P = await searchParams, q = new URLSearchParams();
  for (const [k, v] of Object.entries(P)) if (v && k !== "v" && k !== "inv") q.set(k, v);
  const view = MAP[P.v ?? "sales"] ?? "sales";
  q.set("v", view);
  if (view === "invoices") { q.set("dir", "out"); if (P.inv) q.set("i", `out:${P.inv}`); }
  redirect("/commerce?" + q.toString());
}
