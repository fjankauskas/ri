import { NextResponse } from "next/server";
import { ctx } from "@/lib/ctx";
import { mustCan } from "@/lib/perms-server";
import { lookupOff } from "@/lib/off/service";
// Datos de un GTIN en el catálogo público de Open Food Facts: ?gtin=…&localOnly=1 (solo el catálogo local, sin consultar afuera)
export async function GET(req: Request) {
  await ctx();
  try { await mustCan("gs1", "view"); } catch (e: any) { return NextResponse.json({ status: "unavailable", message: e.message }, { status: 403 }); }
  const u = new URL(req.url);
  return NextResponse.json(await lookupOff(u.searchParams.get("gtin") ?? "", { localOnly: u.searchParams.get("localOnly") === "1" }));
}
