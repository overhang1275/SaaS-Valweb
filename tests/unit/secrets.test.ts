import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "../../src/lib/secrets";

beforeEach(() => { vi.stubEnv("NEXTAUTH_SECRET", "test-mail-settings-encryption-key"); });
afterEach(() => { vi.unstubAllEnvs(); });

it("decrypts tokens queued by the previous mail implementation", () => {
  const previous = "BwcHBwcHBwcHBwcHzMD+csuS/liDnVT0BvodnU7t2fmVJtZfCiO8c0OT8F3GbVay";
  expect(decryptSecret(previous, "legacy-access-token-id")).toBe("legacy-pending-token");
});
it("authenticates the purpose and ciphertext of an encrypted secret", () => {
  const encrypted = encryptSecret("smtp-password", "smtp-settings");
  expect(decryptSecret(encrypted, "smtp-settings")).toBe("smtp-password");
  expect(() => decryptSecret(encrypted, "other-purpose")).toThrow();
  const tampered = Buffer.from(encrypted, "base64"); tampered[tampered.length - 1] ^= 1;
  expect(() => decryptSecret(tampered.toString("base64"), "smtp-settings")).toThrow();
});
it("requires a configured application encryption key", () => {
  vi.stubEnv("NEXTAUTH_SECRET", "");
  expect(() => encryptSecret("password", "smtp-settings")).toThrow("NEXTAUTH_SECRET");
});
