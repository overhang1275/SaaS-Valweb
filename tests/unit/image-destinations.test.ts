import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/lib/prisma", () => {
  const tx = { imageStorageLocation: { findUnique: vi.fn() }, $queryRaw: vi.fn().mockResolvedValue([]) };
  return { prisma: { ...tx, $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)) } };
});
import { prisma } from "../../src/lib/prisma";
import { childDirectory, openDirectory } from "../../src/features/images/filesystem";
import { repairNfsImageFolders } from "../../src/features/images/permissions";
import { writeImageFile, readImageFile, removeImageFile } from "../../src/features/images/storage";

const target = { kind: "LOCAL" as const, tenantId: randomUUID(), validationId: randomUUID() };
const folder = `${target.tenantId}_${target.validationId}`;
let directory: string, configured: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "valweb-destinations-"));
  configured = join(directory, "configured");
  await mkdir(configured);
  vi.stubEnv("IMAGE_STORAGE_DIR", join(directory, "legacy"));
  vi.mocked(prisma.imageStorageLocation.findUnique).mockResolvedValue({ kind: "LOCAL", rootPath: configured, updatedAt: new Date() });
});
afterEach(async () => { vi.unstubAllEnvs(); vi.clearAllMocks(); await rm(directory, { recursive: true, force: true }); });

it("creates the FTP intake folder with shared group access despite a restrictive umask", async () => {
  const oldUmask = process.umask(0o077);
  const root = await openDirectory(configured, false);
  try {
    const folder = await childDirectory(root, "validation", true, 0o2770);
    try {
      const details = await stat(`/proc/self/fd/${folder.fd}`);
      expect(details.mode & 0o2777).toBe(0o2770);
      expect(details.gid).toBe((await root.stat()).gid);
    } finally { await folder.close(); }
  } finally { await root.close(); process.umask(oldUmask); }
});

it("repairs existing FTP folders without changing processed or unrelated directories", async () => {
  const folderName = `${randomUUID()}_${randomUUID()}`;
  const folderPath = join(configured, folderName);
  await mkdir(join(folderPath, "por_procesar"), { recursive: true, mode: 0o700 });
  await mkdir(join(folderPath, "procesadas"), { mode: 0o700 });
  await mkdir(join(configured, "unrelated"), { mode: 0o700 });
  const root = await openDirectory(configured, false), groupId = (await root.stat()).gid;
  try {
    await expect(repairNfsImageFolders(root, [folderName], groupId + 1)).rejects.toThrow(/GID/);
    expect(await repairNfsImageFolders(root, [folderName, `${randomUUID()}_${randomUUID()}`], groupId)).toEqual({ repaired: 1, missing: 1 });
  } finally { await root.close(); }
  expect((await stat(folderPath)).mode & 0o2777).toBe(0o2770);
  expect((await stat(join(folderPath, "por_procesar"))).mode & 0o2777).toBe(0o2770);
  expect((await stat(join(folderPath, "procesadas"))).mode & 0o777).toBe(0o700);
  expect((await stat(join(configured, "unrelated"))).mode & 0o2777).toBe(0o700);
});

it("writes a self-contained key in the validation folder and keeps FTP originals", async () => {
  await mkdir(join(configured, folder));
  const original = join(configured, folder, "ABC123.png");
  await writeFile(original, "original FTP");
  const data = Buffer.from("processed");
  const key = await writeImageFile(data, target);
  expect(key).toMatch(new RegExp(`^v1:LOCAL:${folder}:[a-f0-9-]{36}\\.webp$`));
  expect(key.length).toBeLessThanOrEqual(128);
  expect(await readFile(join(configured, folder, "procesadas", key.split(":").at(-1)!))).toEqual(data);
  expect(await readImageFile(key)).toEqual(data);
  await removeImageFile(key);
  await expect(readImageFile(key)).rejects.toThrow();
  expect(await readFile(original, "utf8")).toBe("original FTP");
});

it("reads legacy files and keeps destinations separate between validations", async () => {
  const legacy = await writeImageFile(Buffer.from("legacy"));
  const first = await writeImageFile(Buffer.from("first"), target);
  const second = await writeImageFile(Buffer.from("second"), { ...target, validationId: randomUUID() });
  expect(first).not.toBe(second);
  expect(await readImageFile(legacy)).toEqual(Buffer.from("legacy"));
  expect(await readImageFile(first)).toEqual(Buffer.from("first"));
  expect(await readImageFile(second)).toEqual(Buffer.from("second"));
});

it("rejects an unconfigured destination rather than writing to legacy storage", async () => {
  vi.mocked(prisma.imageStorageLocation.findUnique).mockResolvedValue(null);
  await expect(writeImageFile(Buffer.from("test"), target)).rejects.toThrow();
  expect(await readdir(directory)).toEqual(["configured"]);
});

it("rejects a local directory selected as NFS before creating validation folders", async () => {
  vi.mocked(prisma.imageStorageLocation.findUnique).mockResolvedValue({ kind: "NFS", rootPath: configured, updatedAt: new Date() });
  await expect(writeImageFile(Buffer.from("test"), { ...target, kind: "NFS" })).rejects.toThrow(/NFS/);
  expect(await readdir(configured)).toEqual([]);
});

it("rejects traversal and symlinked destination folders without writing outside", async () => {
  const outside = join(directory, "outside");
  await mkdir(outside);
  await symlink(outside, join(configured, folder));
  await expect(writeImageFile(Buffer.from("test"), target)).rejects.toThrow();
  expect(await readdir(outside)).toEqual([]);
  await expect(readImageFile(`v1:LOCAL:../../outside:${randomUUID()}.webp`)).rejects.toThrow();
});

it("rejects symlinked image files when reading", async () => {
  await mkdir(join(configured, folder, "procesadas"), { recursive: true });
  const name = `${randomUUID()}.webp`;
  const outside = join(directory, "private.txt");
  await writeFile(outside, "private");
  await symlink(outside, join(configured, folder, "procesadas", name));
  await expect(readImageFile(`v1:LOCAL:${folder}:${name}`)).rejects.toThrow();
});
