import { afterEach, beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(), $queryRaw: vi.fn(), $executeRaw: vi.fn(),
  user: { findUnique: vi.fn() },
  smtpSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock("../../src/lib/prisma", () => ({ prisma: db }));
import { getMailSettings, getSmtpConfig, saveMailSettings } from "../../src/features/system/mail-settings";
import { decryptSecret, encryptSecret } from "../../src/lib/secrets";

const admin = { id: "00000000-0000-4000-8000-000000000001", role: "ADMIN" as const, tenantId: null, sessionVersion: 0 };
const input = { host: "smtp.example.test", port: 587, from: "Valweb <sender@example.test>", user: "mailer@example.test", password: "new-private-password" };
const stored = () => ({ id: 1, host: input.host, port: input.port, from: input.from, user: input.user, encryptedPassword: encryptSecret("previous-password", "smtp-settings"), updatedAt: new Date() });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", "test-mail-settings-encryption-key");
  vi.stubEnv("SMTP_HOST", input.host); vi.stubEnv("SMTP_PORT", "587");
  vi.stubEnv("SMTP_FROM", input.from); vi.stubEnv("SMTP_USER", input.user); vi.stubEnv("SMTP_PASSWORD", "environment-password");
  db.$transaction.mockImplementation(callback => callback(db));
  db.user.findUnique.mockResolvedValue({ ...admin, status: "ACTIVE", tenant: null });
  db.smtpSettings.findUnique.mockResolvedValue(null);
  db.smtpSettings.upsert.mockResolvedValue({});
});
afterEach(() => { vi.unstubAllEnvs(); });

it("uses the environment until settings are saved", async () => {
  expect(await getSmtpConfig()).toMatchObject({ host: input.host, port: 587, from: input.from, user: input.user, password: "environment-password" });
});

it("returns only editable fields and password availability to administrators", async () => {
  db.smtpSettings.findUnique.mockResolvedValue(stored());
  const result = await getMailSettings(admin);
  expect(result).toMatchObject({ host: input.host, from: input.from, hasPassword: true });
  expect(result).not.toHaveProperty("password");
  expect(result).not.toHaveProperty("encryptedPassword");
  expect(JSON.stringify(result)).not.toContain("previous-password");
});

it.each([
  { role: "CLIENT", status: "ACTIVE", sessionVersion: 0, tenant: { status: "ACTIVE" } },
  { role: "CONSULTATION_ONLY", status: "ACTIVE", sessionVersion: 0, tenant: { status: "ACTIVE" } },
  { role: "ADMIN", status: "DISABLED", sessionVersion: 0, tenant: null },
  { role: "ADMIN", status: "ACTIVE", sessionVersion: 1, tenant: null },
])("rejects persisted identity $role/$status/$sessionVersion even with an administrator claim", async identity => {
  db.user.findUnique.mockResolvedValue({ ...admin, ...identity });
  await expect(getMailSettings(admin)).rejects.toThrow();
  await expect(saveMailSettings(admin, input)).rejects.toThrow();
  expect(db.smtpSettings.upsert).not.toHaveBeenCalled();
});

it("encrypts the password before persistence and excludes credentials from audit metadata", async () => {
  await saveMailSettings(admin, input);
  const saved = db.smtpSettings.upsert.mock.calls[0][0];
  expect(saved.create.encryptedPassword).not.toBe(input.password);
  expect(decryptSecret(saved.create.encryptedPassword, "smtp-settings")).toBe(input.password);
  expect(JSON.stringify(saved)).not.toContain(input.password);
  expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain(input.password);
});

it("keeps the stored password when the password field is blank and the account is unchanged", async () => {
  const row = stored(); db.smtpSettings.findUnique.mockResolvedValue(row);
  await saveMailSettings(admin, { ...input, password: "" });
  expect(db.smtpSettings.upsert.mock.calls[0][0].update.encryptedPassword).toBe(row.encryptedPassword);
});

it("retains the environment password on the first save of the same SMTP account", async () => {
  await saveMailSettings(admin, { ...input, password: "" });
  expect(decryptSecret(db.smtpSettings.upsert.mock.calls[0][0].create.encryptedPassword, "smtp-settings")).toBe("environment-password");
});

it.each([{ host: "other.example.test" }, { user: "other@example.test" }])("requires a new password when the account changes: %j", async change => {
  db.smtpSettings.findUnique.mockResolvedValue(stored());
  await expect(saveMailSettings(admin, { ...input, ...change, password: "" })).rejects.toThrow(/contraseña/i);
  expect(db.smtpSettings.upsert).not.toHaveBeenCalled();
});

it("clears stored authentication when saving an anonymous relay", async () => {
  db.smtpSettings.findUnique.mockResolvedValue(stored());
  await saveMailSettings(admin, { ...input, user: "", password: "" });
  expect(db.smtpSettings.upsert.mock.calls[0][0].update.encryptedPassword).toBeNull();
});

it.each([
  { host: "smtp://bad.example.test" }, { host: "smtp.example.test\r\nInjected: true" },
  { port: 0 }, { port: 65536 }, { port: 587.5 },
  { from: "not-an-address" }, { from: "sender@example.test\r\nBcc: other@example.test" },
  { from: "first@example.test,second@example.test" }, { password: "x".repeat(4097) },
])("rejects invalid SMTP fields: %j", async change => {
  await expect(saveMailSettings(admin, { ...input, ...change })).rejects.toThrow();
  expect(db.smtpSettings.upsert).not.toHaveBeenCalled();
});

it("reads updated settings on the next send instead of caching them per process", async () => {
  db.smtpSettings.findUnique.mockResolvedValueOnce(stored()).mockResolvedValueOnce({ ...stored(), host: "updated.example.test" });
  expect((await getSmtpConfig()).host).toBe(input.host);
  expect((await getSmtpConfig()).host).toBe("updated.example.test");
});

it("does not fall back to environment credentials if saved credentials cannot be decrypted", async () => {
  db.smtpSettings.findUnique.mockResolvedValue({ ...stored(), encryptedPassword: "corrupt" });
  await expect(getSmtpConfig()).rejects.toThrow();
});
