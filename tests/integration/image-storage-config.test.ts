import { afterAll, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

import { prisma } from "../../src/lib/prisma";
import { ensureDefaultLocalImageLocation } from "../../src/features/images/locations";

afterAll(async () => { await prisma.$disconnect(); });

it("protects every configured local and NFS root from release pruning even without inspecting its files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "valweb-retention-storage-"));
  const releases = join(directory, "releases");
  const installed = "a".repeat(40), candidate = "b".repeat(40), obsolete = "c".repeat(40);
  const local = join(releases, obsolete, "private-images");
  const nfs = join(releases, obsolete, "remote-images");
  const original = await prisma.imageStorageLocation.findMany();
  try {
    for (const path of [join(releases, installed), join(releases, candidate), local, nfs]) await mkdir(path, { recursive: true });
    await writeFile(join(local, "original.png"), "preserve local original");
    await symlink(join(releases, installed), join(directory, "current"));
    for (const [kind, rootPath] of [["LOCAL", local], ["NFS", nfs]] as const) {
      await prisma.imageStorageLocation.upsert({ where: { kind }, create: { kind, rootPath }, update: { rootPath } });
    }
    const source = await readFile(new URL("../../ops/valweb-install.sh", import.meta.url), "utf8");
    const boundary = source.indexOf('\n[[ ${1:-} == --help');
    if (boundary < 0) throw new Error("Installer command boundary not found");
    // Replace only the OS user/config wrapper; run the actual PostgreSQL query and pruning code.
    const result = spawnSync("bash", ["-c", `${source.slice(0, boundary)}
APP=$1
RELEASES=$APP/releases
run_as_valweb(){ "$@"; }
paths=$(release_storage_paths)
printf '%s\\n' "$paths"
mapfile -t protected < <(printf '%s' "$paths" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>JSON.parse(s).forEach(p=>console.log(p)))')
prune_releases "$2" "\${protected[@]}"`, "installer-storage-test", directory, candidate], {
      cwd: process.cwd(), encoding: "utf8",
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, IMAGE_STORAGE_DIR: join(directory, "legacy-images"), IMPORT_STORAGE_DIR: join(directory, "imports") },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/datos persistentes/i);
    expect(JSON.parse(result.stdout)).toEqual(expect.arrayContaining([local, nfs, join(directory, "legacy-images"), join(directory, "imports")]));
    expect(await readFile(join(local, "original.png"), "utf8")).toBe("preserve local original");
  } finally {
    await prisma.$transaction([
      prisma.imageStorageLocation.deleteMany(),
      prisma.imageStorageLocation.createMany({ data: original }),
    ]);
    await rm(directory, { recursive: true, force: true });
  }
});

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
