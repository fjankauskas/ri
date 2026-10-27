// Código QR de comprobantes electrónicos (RG 4892, especificación de ARCA, versión 1).
export type QrData = { fecha: string; cuit: number; ptoVta: number; tipoCmp: number; nroCmp: number; importe: number; moneda: string; ctz: number; tipoDocRec?: number; nroDocRec?: number; codAut: number };
export function qrUrl(d: QrData, base = "https://www.arca.gob.ar/fe/qr/"): string {
  const json = JSON.stringify({ ver: 1, fecha: d.fecha, cuit: d.cuit, ptoVta: d.ptoVta, tipoCmp: d.tipoCmp, nroCmp: d.nroCmp, importe: d.importe, moneda: d.moneda, ctz: d.ctz, ...(d.tipoDocRec != null ? { tipoDocRec: d.tipoDocRec } : {}), ...(d.nroDocRec != null ? { nroDocRec: d.nroDocRec } : {}), tipoCodAut: "E", codAut: d.codAut });
  return `${base}?p=${Buffer.from(json, "utf8").toString("base64")}`;
}
