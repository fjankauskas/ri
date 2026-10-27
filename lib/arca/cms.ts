import { createPrivateKey, sign as rsaSign, createHash, X509Certificate } from "node:crypto";
import { seq, set, oct, int, oid, nul, ctx, utcTime, read, children } from "./der";

const OID = { data: "1.2.840.113549.1.7.1", signedData: "1.2.840.113549.1.7.2", sha256: "2.16.840.1.101.3.4.2.1", rsa: "1.2.840.113549.1.1.1", contentType: "1.2.840.113549.1.9.3", messageDigest: "1.2.840.113549.1.9.4", signingTime: "1.2.840.113549.1.9.5" };

/** Emisor y número de serie (DER) de un certificado X.509, para el campo IssuerAndSerialNumber del CMS. */
function issuerAndSerial(certDer: Buffer) {
  const cert = read(certDer, 0), tbs = children(certDer, cert)[0].raw;
  const kids = children(tbs, read(tbs, 0));
  let i = 0; if (kids[0].tag === 0xa0) i = 1;          // versión [0] explícita
  const serial = kids[i].raw, issuer = kids[i + 2].raw; // [serie, algoritmo, emisor, ...]
  return seq(issuer, serial);
}

/**
 * Firma `content` (el TRA en XML) como pide el WSAA de ARCA: CMS SignedData con el contenido incluido
 * (equivale a `openssl cms -sign -nodetach`), SHA-256, firmante identificado por emisor+serie y solo el certificado propio.
 * Devuelve el CMS en DER codificado en Base64 (lo que va en el parámetro `in0` de loginCms).
 */
export function signCms(content: string, certPem: string, keyPem: string, now = new Date()): string {
  const key = createPrivateKey(keyPem);
  const certDer = new X509Certificate(certPem).raw;
  const data = Buffer.from(content, "utf8");
  const digestAlg = seq(oid(OID.sha256));
  const attr = (o: string, v: Buffer) => seq(oid(o), set(v));
  const attrs = [
    attr(OID.contentType, oid(OID.data)),
    attr(OID.signingTime, utcTime(now)),
    attr(OID.messageDigest, oct(createHash("sha256").update(data).digest())),
  ].sort(Buffer.compare);                                // DER exige SET OF ordenado
  const signature = rsaSign("sha256", set(...attrs), key); // la firma se calcula sobre el SET (tag 0x31), no sobre [0]
  const signerInfo = seq(int(1), issuerAndSerial(certDer), digestAlg, ctx(0, ...attrs), seq(oid(OID.rsa), nul()), oct(signature));
  const signedData = seq(int(1), set(digestAlg), seq(oid(OID.data), ctx(0, oct(data))), ctx(0, certDer), set(signerInfo));
  return seq(oid(OID.signedData), ctx(0, signedData)).toString("base64");
}
