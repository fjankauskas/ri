import https from "node:https";
// POST SOAP por HTTPS. Si Node rechaza el TLS de ARCA ("dh key too small"), definí ARCA_TLS_LEGACY=1 (solo se relaja para estas llamadas).
export function soapPost(url: string, xml: string, action: string, timeoutMs = 30000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", "Content-Length": Buffer.byteLength(xml), SOAPAction: action },
      ...(process.env.ARCA_TLS_LEGACY === "1" ? { ciphers: "DEFAULT@SECLEVEL=0" } : {}),
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("ARCA no respondió a tiempo (timeout)")));
    req.on("error", (e) => reject(new Error(`No se pudo conectar con ARCA: ${e.message}${/dh key|handshake|ssl/i.test(e.message) ? " (probá definir ARCA_TLS_LEGACY=1)" : ""}`)));
    req.write(xml); req.end();
  });
}
