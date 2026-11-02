import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function secretKey() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET no está configurado.");
  // Preserve the key derivation of queued access emails when sharing encryption with SMTP settings.
  return createHash("sha256").update(`valweb-access-email:${secret}`).digest();
}

export function encryptSecret(value: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function decryptSecret(encrypted: string, context: string): string {
  const value = Buffer.from(encrypted, "base64");
  if (value.length < 29) throw new Error("El secreto cifrado no es válido.");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), value.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
}
