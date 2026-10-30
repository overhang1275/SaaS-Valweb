import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || new URL(url).pathname !== "/valweb_test") throw new Error("TEST_DATABASE_URL must point to valweb_test");
  process.env.DATABASE_URL = url;
});
import { randomUUID } from "node:crypto";
import { hash } from "argon2";
import { prisma } from "../../src/lib/prisma";
import { authenticatePublicClient, hasPublicValidationAccess } from "../../src/features/public/access";

const ids = { admin: randomUUID(), client: randomUUID(), other: randomUUID(), query: randomUUID(), tenant: randomUUID(), otherTenant: randomUUID(), validation: randomUUID(), otherValidation: randomUUID(), openValidation: randomUUID(), dataset: randomUUID(), otherDataset: randomUUID(), openDataset: randomUUID() };
const token = randomUUID(), otherToken = randomUUID(), openToken = randomUUID();
const email = `public-access-${ids.client}@example.test`;
const password = "Public-access-test-password-2026!";

beforeAll(async () => {
  const passwordHash = await hash(password);
  await prisma.tenant.createMany({ data: [{ id: ids.tenant, name: "Protected link account" }, { id: ids.otherTenant, name: "Other protected account" }] });
  await prisma.user.createMany({ data: [
    { id: ids.admin, email: `${ids.admin}@example.test`, name: "Admin", role: "ADMIN", status: "ACTIVE", passwordHash },
    { id: ids.client, email, name: "Client", role: "CLIENT", status: "ACTIVE", tenantId: ids.tenant, passwordHash },
    { id: ids.other, email: `${ids.other}@example.test`, name: "Other client", role: "CLIENT", status: "ACTIVE", tenantId: ids.otherTenant, passwordHash },
    { id: ids.query, email: `query-${ids.query}@example.test`, name: "Query only", role: "CONSULTATION_ONLY", status: "ACTIVE", tenantId: ids.tenant, passwordHash },
  ] });
  for (const [id, tenantId, publicToken, requireClientAccess, datasetId] of [
    [ids.validation, ids.tenant, token, true, ids.dataset],
    [ids.otherValidation, ids.otherTenant, otherToken, true, ids.otherDataset],
    [ids.openValidation, ids.tenant, openToken, false, ids.openDataset],
  ] as const) {
    await prisma.validation.create({ data: { id, tenantId, createdById: ids.admin, name: "Test", title: "Test", instructions: "", successMessage: "OK", errorMessage: "No", publicToken, status: "ACTIVE", requireClientAccess } });
    await prisma.dataset.create({ data: { id: datasetId, tenantId, validationId: id, status: "PUBLISHED" } });
    await prisma.validation.update({ where: { id }, data: { activeDatasetId: datasetId } });
  }
  await prisma.userValidationAccess.create({ data: { tenantId: ids.tenant, userId: ids.query, validationId: ids.validation } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [ids.admin, ids.client, ids.other] } } });
  await prisma.validation.updateMany({ where: { id: { in: [ids.validation, ids.otherValidation, ids.openValidation] } }, data: { activeDatasetId: null } });
  await prisma.dataset.deleteMany({ where: { id: { in: [ids.dataset, ids.otherDataset, ids.openDataset] } } });
  await prisma.validation.deleteMany({ where: { id: { in: [ids.validation, ids.otherValidation, ids.openValidation] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.client, ids.other, ids.query] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [ids.tenant, ids.otherTenant] } } });
  await prisma.$disconnect();
});

describe("protected public validation links", () => {
  it("requires an active client from the assigned account and accepts unprotected links", async () => {
    expect(await hasPublicValidationAccess(ids.validation)).toBe(false);
    const session = await authenticatePublicClient(token, email, password);
    expect(session).toBeTruthy();
    expect(await hasPublicValidationAccess(ids.validation, session!)).toBe(true);
    expect(await hasPublicValidationAccess(ids.otherValidation, session!)).toBe(false);
    expect(await hasPublicValidationAccess(ids.openValidation)).toBe(true);
    expect(await authenticatePublicClient(otherToken, email, password)).toBeNull();
    expect(await authenticatePublicClient(token, `${ids.admin}@example.test`, password)).toBeNull();
    expect(await authenticatePublicClient(token, email, "wrong-password")).toBeNull();
    await prisma.user.update({ where: { id: ids.client }, data: { sessionVersion: { increment: 1 } } });
    expect(await hasPublicValidationAccess(ids.validation, session!)).toBe(false);
  });
  it("limits consultation-only accounts to granted protected validations and revokes access immediately", async () => {
    const queryEmail = `query-${ids.query}@example.test`;
    const session = await authenticatePublicClient(token, queryEmail, password);
    expect(session).toBeTruthy();
    expect(await hasPublicValidationAccess(ids.validation, session!)).toBe(true);
    expect(await hasPublicValidationAccess(ids.otherValidation, session!)).toBe(false);
    expect(await hasPublicValidationAccess(ids.openValidation, session!)).toBe(true);
    await prisma.userValidationAccess.deleteMany({ where: { userId: ids.query, validationId: ids.validation } });
    expect(await hasPublicValidationAccess(ids.validation, session!)).toBe(false);
    await prisma.userValidationAccess.create({ data: { tenantId: ids.tenant, userId: ids.query, validationId: ids.validation } });
    await prisma.tenant.update({ where: { id: ids.tenant }, data: { status: "SUSPENDED" } });
    expect(await hasPublicValidationAccess(ids.validation, session!)).toBe(false);
    await prisma.tenant.update({ where: { id: ids.tenant }, data: { status: "ACTIVE" } });
  });
});
