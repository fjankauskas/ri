import { NextResponse } from "next/server";
import { ctx } from "@/lib/ctx";
import { resolveCode } from "@/lib/gs1/data";
// Busca el producto, lote y stock que corresponden a un código escaneado: ?code=…
export async function GET(req: Request) {
  const { sb, org } = await ctx();
  const code = new URL(req.url).searchParams.get("code") ?? "";
  return NextResponse.json(await resolveCode(sb, org.id, code));
}
