import { generateKeyPairSync, createPublicKey, createPrivateKey, sign as rsaSign, X509Certificate } from "node:crypto";
import { seq, set, int, oid, nul, utf8, printable, bitString, tlv, ctx } from "./der";

const pem = (label: string, der: Buffer) => `-----BEGIN ${label}-----\n${der.toString("base64").replace(/(.{64})/g, "$1\n").trim()}\n-----END ${label}-----\n`;
const ascii = (s: string, max: number) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 .,&()_-]/g, "").trim().slice(0, max) || "empresa";
const rdn = (o: string, v: Buffer) => set(seq(oid(o), v));

/**
 * Genera una clave RSA 2048 y la solicitud de certificado (CSR) con el subject que pide ARCA:
 * C=AR, O=<empresa>, CN=<alias>, serialNumber=CUIT <cuit>  (equivale al comando `openssl req -new -subj ...` del manual).
 */
export function generateKeyAndCsr(opts: { cuit: string; org: string; alias: string }) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const subject = seq(
    rdn("2.5.4.6", printable("AR")),
    rdn("2.5.4.10", utf8(ascii(opts.org, 60))),
    rdn("2.5.4.3", utf8(ascii(opts.alias, 40).replace(/ /g, "-"))),
    rdn("2.5.4.5", printable(`CUIT ${opts.cuit.replace(/\D/g, "")}`)),
  );
  const info = seq(int(0), subject, publicKey.export({ type: "spki", format: "der" }), tlv(0xa0));
  const signature = rsaSign("sha256", info, privateKey);
  const csr = seq(info, seq(oid("1.2.840.113549.1.1.11"), nul()), bitString(signature));
  return { privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string, csrPem: pem("CERTIFICATE REQUEST", csr) };
}

/** Verifica que el certificado corresponda a la clave privada (misma clave pública). */
export function certMatchesKey(certPem: string, keyPem: string): boolean {
  try {
    const cert = new X509Certificate(certPem);
    return cert.checkPrivateKey(createPrivateKey(keyPem)) || cert.publicKey.export({ type: "spki", format: "der" }).equals(createPublicKey(keyPem).export({ type: "spki", format: "der" }));
  } catch { return false; }
}
