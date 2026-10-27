import { NextResponse } from "next/server";
import { ctx } from "@/lib/ctx";
import { renderSymbol, SYMBOLOGIES, type Symbology } from "@/lib/gs1/render";
// Genera un código en SVG: ?type=ean13&data=…&xdim=0.33&h=22.85&text=1&download=1
export async function GET(req: Request) {
  await ctx();
  const u = new URL(req.url), type = u.searchParams.get("type") as Symbology, data = u.searchParams.get("data") ?? "";
  if (!SYMBOLOGIES.some((s) => s.key === type)) return NextResponse.json({ error: "Simbología no soportada" }, { status: 400 });
  try {
    const num = (k: string) => { const v = Number(u.searchParams.get(k)); return v > 0 && v < 500 ? v : undefined; };
    const r = await renderSymbol(type, data, { xDimMm: num("xdim"), heightMm: num("h"), text: u.searchParams.get("text") !== "0" });
    return new NextResponse(r.svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", ...(u.searchParams.get("download") ? { "Content-Disposition": `attachment; filename="${type}.svg"` } : {}) } });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
