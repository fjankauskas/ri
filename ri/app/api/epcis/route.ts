import { NextResponse } from "next/server";
import { ctx } from "@/lib/ctx";
import { buildEpcis } from "@/lib/gs1/epcis";
import { getSettings, loadEpcisRows } from "@/lib/gs1/data";
// EPCIS 2.0 (JSON-LD) con identificadores GS1: ?from=AAAA-MM-DD&to=AAAA-MM-DD&download=1
export async function GET(req: Request) {
  const { sb, org } = await ctx();
  const u = new URL(req.url), from = u.searchParams.get("from") || undefined, to = u.searchParams.get("to") || undefined;
  try {
    const [rows, settings] = await Promise.all([loadEpcisRows(sb, from, to), getSettings(sb, org.id)]);
    const r = buildEpcis(rows, settings);
    return new NextResponse(JSON.stringify(r.doc, null, 2), { headers: { "Content-Type": "application/ld+json; charset=utf-8", "X-Epcis-Mapped": String(r.mapped), "X-Epcis-Unmapped": String(r.unmapped), ...(u.searchParams.get("download") ? { "Content-Disposition": `attachment; filename="epcis-${org.display_name.replace(/[^A-Za-z0-9]+/g, "-")}.json"` } : {}) } });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
