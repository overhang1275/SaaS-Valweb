import { beforeAll, afterAll, expect, it, vi } from "vitest";
vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { listTenantPage, listActiveTenantChoices, listUsers, type Actor } from "../../src/features/identity/service";
import { tenantListQuerySchema, userListQuerySchema } from "../../src/features/identity/list-query";

const run = randomUUID(), adminId = randomUUID(), clientId = randomUUID(), tenantId = randomUUID(), foreignTenantId = randomUUID();
const tenantIds = [tenantId, foreignTenantId, ...Array.from({ length: 61 }, () => randomUUID())];
const admin: Actor = { id: adminId, role: "ADMIN", tenantId: null, sessionVersion: 0 };
const client: Actor = { id: clientId, role: "CLIENT", tenantId, sessionVersion: 0 };
const tenants = (options = {}) => listTenantPage(admin, tenantListQuerySchema.parse({ q: `Catalog ${run}`, ...options }));
const members = (actor = admin, options = {}) => listUsers(actor, userListQuerySchema.parse({ q: `Member ${run}`, ...options }));
beforeAll(async () => {
  await prisma.tenant.createMany({ data: tenantIds.map((id, index) => ({ id, name: index === 0 ? `Account A ${run}` : index === 1 ? `Account B ${run}` : `Catalog ${run} ${index}`, status: index === 62 ? "SUSPENDED" as const : "ACTIVE" as const, createdAt: new Date("2026-10-28T00:00:00Z") })) });
  await prisma.user.createMany({ data: [
    { id: adminId, email: `admin-${run}@example.test`, name: "List operator", role: "ADMIN" as const, status: "ACTIVE" as const },
    { id: clientId, tenantId, email: `client-${run}@example.test`, name: "Account operator", role: "CLIENT" as const, status: "ACTIVE" as const },
    ...Array.from({ length: 60 }, (_, i) => ({ tenantId, email: `member-${i}-${run}@example.test`, name: `Member ${run} ${i}`, role: "CLIENT" as const, status: (["ACTIVE", "INVITED", "DISABLED"] as const)[i % 3], createdAt: new Date("2026-10-28T00:00:00Z") })),
    { tenantId: foreignTenantId, email: `foreign-${run}@example.test`, name: `Member ${run} foreign`, role: "CLIENT" as const, status: "ACTIVE" as const },
  ].map(user => ({ ...user, passwordHash: "unused-test-hash" })) });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { OR: [{ id: adminId }, { tenantId: { in: tenantIds } }] } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});
it("pages clients with stable ordering, true totals and a clamped last page", async () => {
  const first = await tenants(), next = await tenants({ page: 2 }), last = await tenants({ page: 999999 });
  expect(first.total).toBe(61); expect(first.rows).toHaveLength(25); expect(next.rows).toHaveLength(25);
  expect(last.page).toBe(3); expect(last.rows).toHaveLength(11);
  expect(first.rows.map(row => row.id)).toEqual((await tenants()).rows.map(row => row.id));
  expect(next.rows.some(row => first.rows.some(previous => previous.id === row.id))).toBe(false);
  expect((await tenants({ pageSize: 50 })).rows).toHaveLength(50);
  expect((await tenants({ estado: "SUSPENDED" })).total).toBe(1);
  expect((await tenants({ q: `CATALOG ${run}`, estado: "ACTIVE" })).total).toBe(60);
});
it("keeps every active invitation account available and excludes suspended accounts", async () => {
  const choices = await listActiveTenantChoices(admin);
  expect(choices.filter(row => row.name.startsWith(`Catalog ${run}`))).toHaveLength(60);
  expect(choices.some(row => row.id === tenantIds[62])).toBe(false);
  expect(choices).toContainEqual({ id: tenantId, name: `Account A ${run}` });
  expect(Object.keys(choices[0]).sort()).toEqual(["id", "name"]);
});
it("searches users by name, email, state, role and account in the database", async () => {
  const result = await members(admin, { cuenta: `Account A ${run}` });
  expect(result.total).toBe(60); expect(result.rows).toHaveLength(25);
  expect(result.rows[0].tenant?.name).toBe(`Account A ${run}`);
  expect(result.rows[0]).not.toHaveProperty("passwordHash"); expect(result.rows[0]).not.toHaveProperty("sessionVersion");
  expect((await members(admin, { cuenta: `Account A ${run}`, estado: "INVITED", rol: "CLIENT" })).total).toBe(20);
  expect((await members(admin, { q: `MEMBER-2-${run}@EXAMPLE.TEST` })).total).toBe(1);
  expect((await members(admin, { q: "NOEXISTE" })).total).toBe(0);
  expect((await members(admin, { cuenta: `Account A ${run}`, page: 999999 })).page).toBe(3);
  expect((await members(admin, { cuenta: `Account A ${run}`, pageSize: 50 })).rows).toHaveLength(50);
});
it("keeps client searches and forged roles inside their actual account", async () => {
  expect((await members(client)).total).toBe(60);
  expect((await members({ ...client, role: "ADMIN" })).total).toBe(60);
  expect((await members(client, { cuenta: `Account B ${run}` })).total).toBe(0);
  expect((await members(client, { rol: "ADMIN" })).total).toBe(0);
  await expect(listTenantPage(client, tenantListQuerySchema.parse({}))).rejects.toThrow();
  await expect(listTenantPage({ ...client, role: "ADMIN" }, tenantListQuerySchema.parse({}))).rejects.toThrow();
  await expect(listActiveTenantChoices(client)).rejects.toThrow();
});
