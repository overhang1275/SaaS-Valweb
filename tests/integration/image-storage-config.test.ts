import { afterAll, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

import { prisma } from "../../src/lib/prisma";
import { ensureDefaultLocalImageLocation } from "../../src/features/images/locations";

afterAll(async () => { await prisma.$disconnect(); });

it("keeps both backup CLI outputs parseable when dotenv loads configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "valweb-backup-cli-"));
  const configPath = join(directory, ".env");
  await writeFile(configPath, `DATABASE_URL=${process.env.TEST_DATABASE_URL}\n`);
  try {
    for (const args of [
      ["scripts/image-backup-paths-legacy.mjs", configPath],
      ["--import", "tsx", "scripts/image-backup-paths.ts"],
    ]) {
      const result = spawnSync(process.execPath, args, {
        cwd: process.cwd(), encoding: "utf8",
        env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, DOTENV_CONFIG_PATH: configPath },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(expect.any(Array));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("bootstraps the default local path without overwriting administrator configuration", async () => {
  const rollback = new Error("Rollback local destination bootstrap fixture");
  await expect(prisma.$transaction(async tx => {
    await tx.imageStorageLocation.deleteMany();
    await ensureDefaultLocalImageLocation(tx, "/var/lib/valweb/images");
    await tx.imageStorageLocation.create({ data: { kind: "NFS", rootPath: "/mnt/valweb-nfs" } });
    await ensureDefaultLocalImageLocation(tx, "/a/changed/default");
    expect(await tx.imageStorageLocation.findMany({ orderBy: { kind: "asc" }, select: { kind: true, rootPath: true } })).toEqual([
      { kind: "LOCAL", rootPath: "/var/lib/valweb/images" },
      { kind: "NFS", rootPath: "/mnt/valweb-nfs" },
    ]);
    throw rollback;
  })).rejects.toBe(rollback);
});

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
