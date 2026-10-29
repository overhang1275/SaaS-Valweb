import { afterAll, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import type { Prisma } from "../../src/generated/prisma/client";

afterAll(async () => { await prisma.$disconnect(); });

async function validationFixture(tx: Prisma.TransactionClient) {
  const tenant = await tx.tenant.create({ data: { name: "Storage selection test" } });
  const user = await tx.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Storage test", role: "CLIENT", tenantId: tenant.id } });
  return tx.validation.create({ data: {
    tenantId: tenant.id, createdById: user.id, name: "Storage selection", title: "Consulta",
    instructions: "", successMessage: "Encontrado", errorMessage: "No encontrado", publicToken: randomUUID(),
    imageKey: `${randomUUID()}.webp`,
  } });
}

it("keeps legacy storage unset and persists a separate configured destination per validation", async () => {
  const rollback = new Error("Rollback validation storage fixture");
  await expect(prisma.$transaction(async tx => {
    const first = await validationFixture(tx), second = await validationFixture(tx);
    const initial = await tx.$queryRaw<Array<{ imageStorageKind: string | null; imageKey: string }>>`
      SELECT "imageStorageKind", "imageKey" FROM "Validation" WHERE id=${first.id}::uuid`;
    expect(initial).toEqual([{ imageStorageKind: null, imageKey: first.imageKey }]);

    await tx.imageStorageLocation.upsert({ where: { kind: "LOCAL" }, create: { kind: "LOCAL", rootPath: "/srv/valweb" }, update: { rootPath: "/srv/valweb" } });
    await tx.imageStorageLocation.upsert({ where: { kind: "NFS" }, create: { kind: "NFS", rootPath: "/mnt/valweb-nfs" }, update: { rootPath: "/mnt/valweb-nfs" } });
    await tx.$executeRaw`UPDATE "Validation" SET "imageStorageKind"='LOCAL' WHERE id=${first.id}::uuid`;
    await tx.$executeRaw`UPDATE "Validation" SET "imageStorageKind"='NFS' WHERE id=${second.id}::uuid`;

    const selected = await tx.$queryRaw<Array<{ id: string; imageStorageKind: string; rootPath: string }>>`
      SELECT v.id, v."imageStorageKind", s."rootPath" FROM "Validation" v
      JOIN "ImageStorageLocation" s ON s.kind=v."imageStorageKind"
      WHERE v.id IN (${first.id}::uuid, ${second.id}::uuid)`;
    expect(selected).toHaveLength(2);
    expect(selected).toEqual(expect.arrayContaining([
      { id: first.id, imageStorageKind: "LOCAL", rootPath: "/srv/valweb" },
      { id: second.id, imageStorageKind: "NFS", rootPath: "/mnt/valweb-nfs" },
    ]));
    expect((await tx.validation.findUniqueOrThrow({ where: { id: first.id } })).imageKey).toBe(first.imageKey);
    throw rollback;
  })).rejects.toBe(rollback);
});

it("rejects selecting a destination that has no global configuration", async () => {
  await expect(prisma.$transaction(async tx => {
    await tx.imageStorageLocation.deleteMany({ where: { kind: "NFS" } });
    const validation = await validationFixture(tx);
    await tx.$executeRaw`UPDATE "Validation" SET "imageStorageKind"='NFS' WHERE id=${validation.id}::uuid`;
  })).rejects.toMatchObject({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "23503" } } } });
});

it("prevents deleting a configured destination referenced by a validation", async () => {
  await expect(prisma.$transaction(async tx => {
    await tx.imageStorageLocation.upsert({ where: { kind: "LOCAL" }, create: { kind: "LOCAL", rootPath: "/srv/valweb" }, update: {} });
    const validation = await validationFixture(tx);
    await tx.$executeRaw`UPDATE "Validation" SET "imageStorageKind"='LOCAL' WHERE id=${validation.id}::uuid`;
    await tx.imageStorageLocation.delete({ where: { kind: "LOCAL" } });
  })).rejects.toMatchObject({ code: "P2003" });
});
