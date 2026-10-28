import { beforeAll, afterAll, expect, it, vi } from "vitest";
vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { createValidation, getValidationStatistics, deleteValidation } from "../../src/features/validations/service";
import { verifyAlfanum } from "../../src/features/public/service";
import type { Actor } from "../../src/features/identity/service";
const tenantId = randomUUID(), foreignTenantId = randomUUID(), userId = randomUUID(), foreignId = randomUUID(), adminId = randomUUID();
const actor: Actor = { id: userId, role: "CLIENT", tenantId, sessionVersion: 0 };
const foreign: Actor = { id: foreignId, role: "CLIENT", tenantId: foreignTenantId, sessionVersion: 0 };
const admin: Actor = { id: adminId, role: "ADMIN", tenantId: null, sessionVersion: 0 };
const texts = { name: "Estadísticas", title: "Consulta", instructions: "Código", successMessage: "Encontrado", errorMessage: "No encontrado" };
beforeAll(async () => {
  await prisma.tenant.createMany({ data: [{ id: tenantId, name: "Statistics" }, { id: foreignTenantId, name: "Foreign" }] });
  await prisma.user.createMany({ data: [actor, foreign, admin].map(user => ({ id: user.id, tenantId: user.tenantId, role: user.role, status: "ACTIVE", email: `${user.id}@example.test`, name: "Statistics test", passwordHash: "unused-test-hash" })) });
});
afterAll(async () => {
  const where = { tenantId: { in: [tenantId, foreignTenantId] } };
  await prisma.validationDailyStat.deleteMany({ where });
  await prisma.validation.updateMany({ where, data: { activeDatasetId: null } });
  await prisma.folio.deleteMany({ where }); await prisma.dataset.deleteMany({ where }); await prisma.validation.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [userId, foreignId, adminId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, foreignId, adminId] } } }); await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignTenantId] } } });
  await prisma.$disconnect();
});
it("shows zeros without a published base or any queries", async () => {
  const validation = await createValidation(actor, texts);
  expect(await getValidationStatistics(actor, validation.id)).toEqual({ records: 0, queries: 0n, found: 0n, notFound: 0n });
});
it("counts only the current published base, accumulates days and preserves bigint precision", async () => {
  const validation = await createValidation(actor, texts);
  const other = await createValidation(actor, texts);
  const published = await prisma.dataset.create({ data: { tenantId, validationId: validation.id, status: "PUBLISHED", recordCount: 999 } });
  const pending = await prisma.dataset.create({ data: { tenantId, validationId: validation.id, status: "READY" } });
  await prisma.folio.createMany({ data: [published.id, pending.id].flatMap(datasetId => ["A1", "A2"].map(alfanum => ({ tenantId, validationId: validation.id, datasetId, folio: "0001", alfanum, alfanumNormalized: alfanum }))) });
  await prisma.validation.update({ where: { id: validation.id }, data: { activeDatasetId: published.id } });
  await prisma.validationDailyStat.createMany({ data: [
    { tenantId, validationId: validation.id, date: new Date("2026-01-01"), found: 9007199254740993n, notFound: 2 },
    { tenantId, validationId: validation.id, date: new Date("2026-01-02"), found: 3, notFound: 4 },
    { tenantId, validationId: other.id, date: new Date("2026-01-01"), found: 999, notFound: 999 },
  ] });
  const expected = { records: 2, queries: 9007199254741002n, found: 9007199254740996n, notFound: 6n };
  expect(await getValidationStatistics(actor, validation.id)).toEqual(expected);
  expect(await getValidationStatistics(admin, validation.id)).toEqual(expected);
  await prisma.validation.update({ where: { id: validation.id }, data: { activeDatasetId: pending.id } });
  expect(await getValidationStatistics(actor, validation.id)).toMatchObject({ records: 0 });
});
it("reflects actual successful and unsuccessful public lookups", async () => {
  const validation = await createValidation(actor, texts);
  const dataset = await prisma.dataset.create({ data: { tenantId, validationId: validation.id, status: "PUBLISHED" } });
  await prisma.folio.create({ data: { tenantId, validationId: validation.id, datasetId: dataset.id, folio: "0001", alfanum: "A1", alfanumNormalized: "A1" } });
  await prisma.validation.update({ where: { id: validation.id }, data: { activeDatasetId: dataset.id, showImage: false, status: "ACTIVE" } });
  await verifyAlfanum(validation.publicToken, "a1", "a".repeat(64)); await verifyAlfanum(validation.publicToken, "MISSING", "a".repeat(64));
  expect(await getValidationStatistics(actor, validation.id)).toEqual({ records: 1, queries: 2n, found: 1n, notFound: 1n });
});
it("rejects foreign scope, forged admin claims, deleted ids and revoked sessions", async () => {
  const validation = await createValidation(actor, texts);
  expect(await getValidationStatistics(foreign, validation.id)).toBeNull();
  expect(await getValidationStatistics({ ...foreign, role: "ADMIN", tenantId }, validation.id)).toBeNull();
  expect(await getValidationStatistics(actor, randomUUID())).toBeNull();
  await expect(getValidationStatistics(actor, "invalid")).rejects.toThrow();
  await deleteValidation(actor, validation.id);
  expect(await getValidationStatistics(actor, validation.id)).toBeNull();
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: 1 } });
  await expect(getValidationStatistics(actor, validation.id)).rejects.toThrow();
});
