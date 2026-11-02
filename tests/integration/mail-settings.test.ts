import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
import { prisma } from "../../src/lib/prisma";
import { getMailSettings, getSmtpConfig, saveMailSettings } from "../../src/features/system/mail-settings";

const adminId = randomUUID(), clientId = randomUUID(), tenantId = randomUUID();
const admin = { id: adminId, role: "ADMIN" as const, tenantId: null, sessionVersion: 0 };
const input = { host: "smtp.example.test", port: 587, from: "Valweb <sender@example.test>", user: "mailer@example.test", password: "test-only-private-password" };
let original: Awaited<ReturnType<typeof prisma.smtpSettings.findUnique>>;

beforeAll(async () => {
  vi.stubEnv("NEXTAUTH_SECRET", "integration-mail-settings-encryption-key");
  original = await prisma.smtpSettings.findUnique({ where: { id: 1 } });
  await prisma.tenant.create({ data: { id: tenantId, name: "SMTP settings test" } });
  await prisma.user.createMany({ data: [
    { id: adminId, email: `${adminId}@example.test`, name: "SMTP admin", role: "ADMIN", status: "ACTIVE", passwordHash: "unused-test-hash" },
    { id: clientId, email: `${clientId}@example.test`, name: "SMTP client", role: "CLIENT", status: "ACTIVE", tenantId, passwordHash: "unused-test-hash" },
  ] });
});
beforeEach(async () => {
  await prisma.smtpSettings.deleteMany();
  await prisma.user.update({ where: { id: adminId }, data: { status: "ACTIVE", sessionVersion: 0 } });
});
afterAll(async () => {
  await prisma.smtpSettings.deleteMany();
  if (original) await prisma.smtpSettings.create({ data: original });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, clientId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, clientId] } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

it("persists encrypted settings, retains blank credentials and applies replacements on the next read", async () => {
  await saveMailSettings(admin, input);
  const saved = await prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } });
  expect(saved.encryptedPassword).not.toBe(input.password);
  expect(await getSmtpConfig()).toMatchObject(input);
  const publicFields = await getMailSettings(admin);
  expect(publicFields.hasPassword).toBe(true);
  expect(publicFields).not.toHaveProperty("encryptedPassword");
  expect(publicFields).not.toHaveProperty("password");
  await saveMailSettings(admin, { ...input, password: "", from: "updated@example.test" });
  expect((await prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } })).encryptedPassword).toBe(saved.encryptedPassword);
  await expect(saveMailSettings(admin, { ...input, host: "new.example.test", password: "" })).rejects.toThrow(/contraseña/);
  expect((await getSmtpConfig()).host).toBe(input.host);
  await saveMailSettings(admin, { ...input, host: "new.example.test", password: "replacement-password" });
  expect(await getSmtpConfig()).toMatchObject({ host: "new.example.test", password: "replacement-password" });
  const audit = await prisma.auditLog.findMany({ where: { actorId: adminId, action: "SMTP_SETTINGS_UPDATED" } });
  expect(audit).toHaveLength(3);
  expect(JSON.stringify(audit)).not.toContain(input.password);
});

it("rejects a forged administrator claim and a revoked administrator session", async () => {
  await expect(saveMailSettings({ ...admin, id: clientId, tenantId }, input)).rejects.toThrow();
  expect(await prisma.smtpSettings.count()).toBe(0);
  await prisma.user.update({ where: { id: adminId }, data: { sessionVersion: 1 } });
  await expect(saveMailSettings(admin, input)).rejects.toThrow();
  await expect(getMailSettings(admin)).rejects.toThrow();
  expect(await prisma.smtpSettings.count()).toBe(0);
});
