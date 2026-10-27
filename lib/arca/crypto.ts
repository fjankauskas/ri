import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
// La clave privada de cada empresa se guarda cifrada (AES-256-GCM) con ARCA_ENCRYPTION_KEY, que vive solo en el servidor.
function key(): Buffer {
  const raw = process.env.ARCA_ENCRYPTION_KEY ?? "";
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("Falta ARCA_ENCRYPTION_KEY (32 bytes en base64). Generala con: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"");
  return k;
}
export const hasEncryptionKey = () => Buffer.from(process.env.ARCA_ENCRYPTION_KEY ?? "", "base64").length === 32;
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
export function decryptSecret(blob: string): string {
  const [v, iv, tag, enc] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Clave guardada con un formato desconocido");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  try { return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8"); }
  catch { throw new Error("No se pudo descifrar la clave: ¿cambió ARCA_ENCRYPTION_KEY?"); }
}
