import { NextResponse } from "next/server";
import { ctx } from "@/lib/ctx";
import { mustCan } from "@/lib/perms-server";
import { lookupGtin } from "@/lib/gs1ar/service";
// Datos oficiales de un GTIN según GS1 Argentina: ?gtin=…&force=1 (force saltea la caché)
export async function GET(req: Request) {
  const { org } = await ctx();
  try { await mustCan("gs1", "view"); } catch (e: any) { return NextResponse.json({ ok: false, code: "NO_ACCESS", message: e.message }, { status: 403 }); }
  const u = new URL(req.url);
  return NextResponse.json(await lookupGtin(org.id, u.searchParams.get("gtin") ?? "", { force: u.searchParams.get("force") === "1" }));
}
