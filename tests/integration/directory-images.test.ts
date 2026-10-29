import { afterAll, beforeAll, afterEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/prisma";
import { captureDirectoryImport, readDirectorySnapshot, readDirectorySnapshotFile } from "../../src/features/imports/directory";
import { processImport } from "../../src/features/imports/runner";
import { cleanupDirectoryImport, publishDirectoryImport } from "../../src/features/imports/service";
import { deleteRecordImage } from "../../src/features/records/images";

const tenantId = randomUUID(), userId = randomUUID();
let base: string, root: string, inbox: string, validationId: string, originalLocal: { rootPath: string } | null;
const jobIds: string[] = [];

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "valweb-directory-images-"));
  root = join(base, "images");
  vi.stubEnv("IMPORT_STORAGE_DIR", join(base, "imports"));
  originalLocal = await prisma.imageStorageLocation.findUnique({ where: { kind: "LOCAL" }, select: { rootPath: true } });
  await prisma.imageStorageLocation.upsert({ where: { kind: "LOCAL" }, create: { kind: "LOCAL", rootPath: root }, update: { rootPath: root } });
  await prisma.tenant.create({ data: { id: tenantId, name: "Directory image fixtures" } });
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, name: "FTP capture", role: "CLIENT", status: "ACTIVE", tenantId, passwordHash: "unused-test-hash" } });
  const validation = await prisma.validation.create({ data: { tenantId, createdById: userId, publicToken: randomUUID(), name: "Directory capture", title: "Consulta", instructions: "", successMessage: "Sí", errorMessage: "No", imageMode: "PER_RECORD", imageStorageKind: "LOCAL" } });
  validationId = validation.id;
  inbox = join(root, `${tenantId}_${validationId}`, "por_procesar");
});

afterEach(async () => {
  await prisma.importJob.deleteMany({ where: { id: { in: jobIds.splice(0) } } });
  await prisma.recordImage.deleteMany({ where: { validationId } });
  await rm(join(root, `${tenantId}_${validationId}`), { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.validation.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  if (originalLocal) await prisma.imageStorageLocation.update({ where: { kind: "LOCAL" }, data: originalLocal });
  else await prisma.imageStorageLocation.delete({ where: { kind: "LOCAL" } });
  await prisma.$disconnect(); vi.unstubAllEnvs(); await rm(base, { recursive: true, force: true });
});

async function job() {
  await mkdir(inbox, { recursive: true });
  const id = randomUUID(); jobIds.push(id);
  const validation = await prisma.validation.findUniqueOrThrow({ where: { id: validationId }, select: { imageRevision: true } });
  return prisma.importJob.create({ data: { id, tenantId, validationId, requestedById: userId, kind: "IMAGES", imageStorageKind: "LOCAL", sourceKey: `${id}.directory`, originalName: "por_procesar", status: "PROCESSING", phase: "Capturando", baseImageRevision: validation.imageRevision } });
}
async function image(color: string) { return sharp({ create: { width: 12, height: 8, channels: 3, background: color } }).png().toBuffer(); }
async function collect<T>(items: AsyncIterable<T>) { const values: T[] = []; for await (const item of items) values.push(item); return values; }

it("captures a private immutable snapshot and leaves the FTP original in place", async () => {
  await mkdir(inbox, { recursive: true }); const bytes = await image("#aa1122"); await writeFile(join(inbox, "ABC123.png"), bytes);
  const current = await job(); await captureDirectoryImport(current);
  const [record] = await collect(readDirectorySnapshot(current.id));
  expect(record).toMatchObject({ filename: "ABC123.png", bytes: bytes.length, sourceHash: createHash("sha256").update(bytes).digest("hex") });
  expect(await readDirectorySnapshotFile(current.id, record)).toEqual(bytes);
  await writeFile(join(inbox, "ABC123.png"), await image("#1122aa"));
  await captureDirectoryImport(current);
  expect(await readDirectorySnapshotFile(current.id, record)).toEqual(bytes);
  expect(await readFile(join(inbox, "ABC123.png"))).not.toEqual(bytes);
});

it("accepts an empty inbox as a complete zero-file snapshot", async () => {
  const current = await job(); await captureDirectoryImport(current);
  expect(await collect(readDirectorySnapshot(current.id))).toEqual([]);
  expect((await prisma.importJob.findUniqueOrThrow({ where: { id: current.id } })).phase).toBe("Carpeta vacía");
});

it("rejects duplicate normalized alfanuméricos without completing the snapshot", async () => {
  await mkdir(inbox, { recursive: true });
  await writeFile(join(inbox, "ABC123.png"), await image("#aa1122"));
  await writeFile(join(inbox, "abc123.jpg"), await sharp({ create: { width: 12, height: 8, channels: 3, background: "#1122aa" } }).jpeg().toBuffer());
  const current = await job(); await expect(captureDirectoryImport(current)).rejects.toThrow("Hay más de una imagen");
  await expect(collect(readDirectorySnapshot(current.id))).rejects.toThrow("incompleta");
});

it("rejects corrupt images and image symlinks", async () => {
  await mkdir(inbox, { recursive: true });
  const current = await job(); await writeFile(join(inbox, "BROKEN.png"), Buffer.from("no es png"));
  await expect(captureDirectoryImport(current)).rejects.toThrow();
  await rm(join(root, `${tenantId}_${validationId}`), { recursive: true, force: true });
  await mkdir(inbox, { recursive: true });
  await writeFile(join(base, "outside.png"), await image("#aa1122")); await symlink(join(base, "outside.png"), join(inbox, "LINK123.png"));
  const second = await job(); await expect(captureDirectoryImport(second)).rejects.toThrow("enlace simbólico");
});

it("does not reread FTP after an interrupted snapshot", async () => {
  await mkdir(inbox, { recursive: true }); const bytes = await image("#aa1122"); await writeFile(join(inbox, "INT123.png"), bytes);
  const current = await job(), interrupted = join(base, "imports", "directory", current.id);
  await mkdir(interrupted, { recursive: true }); await writeFile(join(interrupted, ".started"), "interrupted");
  await expect(captureDirectoryImport(current)).rejects.toThrow("Inicia un análisis nuevo");
  await expect(collect(readDirectorySnapshot(current.id))).rejects.toThrow("incompleta");
  expect(await readFile(join(inbox, "INT123.png"))).toEqual(bytes);
});

it("preserves FTP originals when access is revoked before the worker starts", async () => {
  await mkdir(inbox, { recursive: true }); const bytes = await image("#aa1122"); await writeFile(join(inbox, "REV123.png"), bytes);
  const current = await job(); await prisma.user.update({ where: { id: userId }, data: { status: "DISABLED" } });
  await processImport(current.id);
  expect((await prisma.importJob.findUniqueOrThrow({ where: { id: current.id } })).status).toBe("FAILED");
  expect(await readFile(join(inbox, "REV123.png"))).toEqual(bytes);
  expect(await prisma.recordImage.count({ where: { validationId } })).toBe(0);
  await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
});

it("processes, publishes, and removes only the unchanged FTP original", async () => {
  await mkdir(inbox, { recursive: true }); const bytes = await image("#aa1122"); await writeFile(join(inbox, "NEW123.png"), bytes);
  const current = await job(); await processImport(current.id);
  const published = await prisma.recordImage.findUniqueOrThrow({ where: { tenantId_validationId_alfanumNormalized: { tenantId, validationId, alfanumNormalized: "NEW123" } } });
  expect(published.sourceHash).toBe(createHash("sha256").update(bytes).digest("hex"));
  await expect(readFile(join(inbox, "NEW123.png"))).rejects.toMatchObject({ code: "ENOENT" });
  await cleanupDirectoryImport({ id: userId, role: "CLIENT", tenantId, sessionVersion: 0 }, current.id);
  await cleanupDirectoryImport({ id: userId, role: "CLIENT", tenantId, sessionVersion: 0 }, current.id);
  expect((await prisma.importJob.findUniqueOrThrow({ where: { id: current.id } })).phase).toBe("Imágenes publicadas; originales procesados");
});

it("keeps changed originals and requires confirmation before replacing a published image", async () => {
  const originalKey = `${randomUUID()}.webp`;
  await prisma.recordImage.create({ data: { tenantId, validationId, alfanumNormalized: "OLD123", originalName: "OLD123.png", storageKey: originalKey, width: 12, height: 8, size: 20 } });
  const old = await image("#aa1122"), fresh = await image("#1122aa");
  await mkdir(inbox, { recursive: true });
  await writeFile(join(inbox, "OLD123.png"), old);
  const current = await job(); await captureDirectoryImport(current);
  await writeFile(join(inbox, "OLD123.png"), fresh);
  await processImport(current.id);
  expect((await prisma.importJob.findUniqueOrThrow({ where: { id: current.id } })).status).toBe("REVIEW");
  const existing = await prisma.recordImage.findUniqueOrThrow({ where: { tenantId_validationId_alfanumNormalized: { tenantId, validationId, alfanumNormalized: "OLD123" } } });
  expect(existing.storageKey).toBe(originalKey);
  await expect(deleteRecordImage({ id: userId, role: "CLIENT", tenantId, sessionVersion: 0 }, validationId, existing.id, true)).rejects.toMatchObject({ status: 409 });
  expect(await readFile(join(inbox, "OLD123.png"))).toEqual(fresh);
  await publishDirectoryImport({ id: userId, role: "CLIENT", tenantId, sessionVersion: 0 }, current.id);
  const updated = await prisma.recordImage.findUniqueOrThrow({ where: { tenantId_validationId_alfanumNormalized: { tenantId, validationId, alfanumNormalized: "OLD123" } } });
  expect(updated.storageKey).not.toBe(originalKey);
  expect(updated.sourceHash).toBe(createHash("sha256").update(old).digest("hex"));
  expect(await readFile(join(inbox, "OLD123.png"))).toEqual(fresh);
});

it("rejects a stale replacement review without changing catalog or FTP originals", async () => {
  const originalKey = `${randomUUID()}.webp`, bytes = await image("#aa1122");
  await prisma.recordImage.create({ data: { tenantId, validationId, alfanumNormalized: "STALE1", originalName: "STALE1.png", storageKey: originalKey, width: 12, height: 8, size: 20 } });
  await mkdir(inbox, { recursive: true }); await writeFile(join(inbox, "STALE1.png"), bytes);
  const current = await job(); await processImport(current.id);
  expect((await prisma.importJob.findUniqueOrThrow({ where: { id: current.id } })).status).toBe("REVIEW");
  await prisma.validation.update({ where: { id: validationId }, data: { imageRevision: { increment: 1 } } });
  await expect(publishDirectoryImport({ id: userId, role: "CLIENT", tenantId, sessionVersion: 0 }, current.id)).rejects.toThrow("El catálogo o el destino cambió");
  expect((await prisma.recordImage.findUniqueOrThrow({ where: { tenantId_validationId_alfanumNormalized: { tenantId, validationId, alfanumNormalized: "STALE1" } } })).storageKey).toBe(originalKey);
  expect((await prisma.importJob.findUniqueOrThrow({ where: { id: current.id } })).status).toBe("REVIEW");
  expect(await readFile(join(inbox, "STALE1.png"))).toEqual(bytes);
});
