import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const grantSchema = z.object({ validationId: z.uuid(), datasetId: z.uuid(), imageId: z.uuid().nullable(), storageKey: z.string().max(128), viewerHash: z.string().regex(/^[a-f0-9]{64}$/), exp: z.number() });
type Grant = z.infer<typeof grantSchema>;
function key() {
  if (!process.env.NEXTAUTH_SECRET) throw new Error("Falta configurar el secreto de sesión.");
  return createHash("sha256").update(process.env.NEXTAUTH_SECRET).digest();
}
export function createImageGrant(input: Omit<Grant, "exp">) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const data = Buffer.concat([cipher.update(JSON.stringify({ ...input, exp: Date.now() + 5 * 60000 })), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64url");
}
export function readImageGrant(value: string): Grant | null {
  try {
    if (value.length > 2048) return null;
    const raw = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const input = grantSchema.parse(JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString()));
    return input.exp > Date.now() ? input : null;
  } catch { return null; }
}
