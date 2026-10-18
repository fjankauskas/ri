import QRCode from "qrcode";
export async function GET(req: Request) {
  const u = new URL(req.url), lot = u.searchParams.get("lot") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(lot)) return new Response("lote inválido", { status: 400 });
  const svg = await QRCode.toString(`${u.origin}/trace?lot=${lot}`, { type: "svg", margin: 1, width: 180 });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=3600" } });
}
