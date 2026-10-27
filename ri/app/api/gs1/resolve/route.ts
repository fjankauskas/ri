import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
// Público (sin sesión): datos de producto y lote que la empresa decidió publicar. ?gtin=…&lot=…
export async function GET(req: Request) {
  const u = new URL(req.url), gtin = u.searchParams.get("gtin") ?? "", lot = u.searchParams.get("lot");
  const sb = await supabaseServer();
  const { data, error } = await sb.rpc("gs1_resolve", { p_gtin: gtin, p_lot: lot });
  if (error) return NextResponse.json({ found: false, reason: "error" }, { status: 500 });
  return NextResponse.json(data, { status: data?.found ? 200 : 404, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" } });
}
