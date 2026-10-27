import { NextResponse } from "next/server";
import { ctx } from "@/lib/ctx";
import { productJsonLd, productsCsv, type Master, type PackLevel } from "@/lib/gs1/master";
import { DL_BASE } from "@/lib/gs1/digitallink";
import { toGtin14 } from "@/lib/gs1/check";
// Fichas de producto: ?format=csv | jsonld
export async function GET(req: Request) {
  const { sb, org } = await ctx();
  const fmt = new URL(req.url).searchParams.get("format") === "jsonld" ? "jsonld" : "csv";
  const [{ data: prods }, { data: masters }, { data: packs }] = await Promise.all([
    sb.from("products").select("id, sku, name, unit, gtin").eq("organization_id", org.id).eq("is_active", true).order("name"),
    sb.from("product_gs1").select("*").eq("organization_id", org.id), sb.from("product_gtins").select("product_id, gtin, level, units_per_pack, description").eq("organization_id", org.id),
  ]);
  const M = new Map(((masters as any[]) ?? []).map((m) => [m.product_id, m as Master])), rows = ((prods as any[]) ?? []).map((p) => ({ p, m: M.get(p.id) ?? null, packs: ((packs as any[]) ?? []).filter((k) => k.product_id === p.id) as PackLevel[] }));
  const name = org.display_name.replace(/[^A-Za-z0-9]+/g, "-");
  if (fmt === "csv") return new NextResponse(productsCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fichas-${name}.csv"` } });
  const docs = rows.map((r) => productJsonLd(r.p, r.m, org.display_name, r.packs, r.p.gtin ? `${DL_BASE}/01/${toGtin14(r.p.gtin)}` : undefined));
  return new NextResponse(JSON.stringify({ "@context": "https://schema.org/", "@graph": docs }, null, 2), { headers: { "Content-Type": "application/ld+json; charset=utf-8", "Content-Disposition": `attachment; filename="fichas-${name}.jsonld"` } });
}
