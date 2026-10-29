import { afterAll, expect, it, vi } from "vitest";

vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

import { prisma } from "../../src/lib/prisma";

afterAll(async () => { await prisma.$disconnect(); });

it("persists and updates independent global local and NFS roots", async () => {
  const rollback = new Error("Rollback storage configuration fixture");
  await expect(prisma.$transaction(async tx => {
    await tx.imageStorageLocation.deleteMany();
    const initialDate = new Date("2026-01-01T00:00:00Z");
    await tx.imageStorageLocation.create({ data: { kind: "LOCAL", rootPath: "/var/lib/valweb/images", updatedAt: initialDate } });
    await tx.imageStorageLocation.create({ data: { kind: "NFS", rootPath: "/mnt/valweb-nfs" } });

    expect(await tx.imageStorageLocation.findMany({ orderBy: { kind: "asc" }, select: { kind: true, rootPath: true } })).toEqual([
      { kind: "LOCAL", rootPath: "/var/lib/valweb/images" },
      { kind: "NFS", rootPath: "/mnt/valweb-nfs" },
    ]);

    const updated = await tx.imageStorageLocation.update({ where: { kind: "LOCAL" }, data: { rootPath: "/srv/valweb/images" } });
    expect(updated.rootPath).toBe("/srv/valweb/images");
    expect(updated.updatedAt.getTime()).toBeGreaterThan(initialDate.getTime());
    expect((await tx.imageStorageLocation.findUniqueOrThrow({ where: { kind: "NFS" } })).rootPath).toBe("/mnt/valweb-nfs");

    throw rollback;
  })).rejects.toBe(rollback);
});

it("rejects a second global configuration for the same storage kind", async () => {
  await expect(prisma.$transaction(async tx => {
    await tx.imageStorageLocation.deleteMany();
    await tx.imageStorageLocation.create({ data: { kind: "LOCAL", rootPath: "/var/lib/valweb/images" } });
    await tx.imageStorageLocation.create({ data: { kind: "LOCAL", rootPath: "/another/root" } });
  })).rejects.toMatchObject({ code: "P2002" });
});
