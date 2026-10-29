import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/prisma";
import { createValidation, setValidationStatus } from "../../src/features/validations/service";
import { replaceValidationImage } from "../../src/features/images/service";
import { replaceRecordImage } from "../../src/features/records/images";
import { processImport } from "../../src/features/imports/runner";
import { sourcePath } from "../../src/features/imports/files";
import { verifyAlfanum, publicImage } from "../../src/features/public/service";
import * as storage from "../../src/features/images/storage";
import type { Actor } from "../../src/features/identity/service";

const tenantId = randomUUID(), userId = randomUUID();
const actor: Actor = { id: userId, tenantId, role: "CLIENT", sessionVersion: 0 };
const texts = { name: "Destination test", title: "Consulta", instructions: "", successMessage: "Yes", errorMessage: "No" };
let directory: string, input: Buffer, previousRoot: string | undefined;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "valweb-write-destinations-"));
  await mkdir(join(directory, "configured")); await mkdir(join(directory, "imports"));
  vi.stubEnv("IMAGE_STORAGE_DIR", join(directory, "legacy")); vi.stubEnv("IMPORT_STORAGE_DIR", join(directory, "imports"));
  previousRoot = (await prisma.imageStorageLocation.findUnique({ where: { kind: "LOCAL" } }))?.rootPath;
  await prisma.imageStorageLocation.upsert({ where: { kind: "LOCAL" }, create: { kind: "LOCAL", rootPath: join(directory, "configured") }, update: { rootPath: join(directory, "configured") } });
  await prisma.tenant.create({ data: { id: tenantId, name: "Destination tests" } });
  await prisma.user.create({ data: { id: userId, tenantId, role: "CLIENT", status: "ACTIVE", name: "Test", email: `${userId}@example.test`, passwordHash: "unused-test-hash" } });
  input = await sharp({ create: { width: 80, height: 60, channels: 3, background: "white" } }).png().toBuffer();
});
afterAll(async () => {
  vi.restoreAllMocks();
  const where = { tenantId };
  await prisma.validationDailyStat.deleteMany({ where });
  await prisma.importJob.deleteMany({ where }); await prisma.recordImage.deleteMany({ where });
  await prisma.validation.updateMany({ where, data: { activeDatasetId: null } });
  await prisma.folio.deleteMany({ where }); await prisma.dataset.deleteMany({ where }); await prisma.validation.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { actorId: userId } }); await prisma.user.deleteMany({ where: { id: userId } }); await prisma.tenant.deleteMany({ where: { id: tenantId } });
  if (previousRoot === undefined) await prisma.imageStorageLocation.delete({ where: { kind: "LOCAL" } });
  else await prisma.imageStorageLocation.update({ where: { kind: "LOCAL" }, data: { rootPath: previousRoot } });
  await prisma.$disconnect(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true });
});

it("writes shared images into the selected destination", async () => {
  const validation = await createValidation(actor, { ...texts, imageMode: "SHARED" });
  await prisma.$executeRaw`UPDATE "Validation" SET "imageStorageKind"='LOCAL' WHERE id=${validation.id}::uuid`;
  await replaceValidationImage(actor, validation.id, input, "shared.png", "image/png");
  const saved = await prisma.validation.findUniqueOrThrow({ where: { id: validation.id } });
  expect(saved.imageKey).toMatch(/^v1:LOCAL:/);
  expect((await storage.readImageFile(saved.imageKey!)).length).toBeGreaterThan(0);
});

it("rejects a destination changed during upload and retires the unlinked file", async () => {
  const validation = await createValidation(actor, { ...texts, imageMode: "SHARED" });
  await prisma.validation.update({ where: { id: validation.id }, data: { imageStorageKind: "LOCAL" } });
  const write = storage.writeImageFile;
  let written: string | undefined;
  const spy = vi.spyOn(storage, "writeImageFile").mockImplementationOnce(async (...args) => {
    written = await write(...args);
    await prisma.validation.update({ where: { id: validation.id }, data: { imageStorageKind: null } });
    return written;
  });
  try { await expect(replaceValidationImage(actor, validation.id, input, "shared.png", "image/png")).rejects.toMatchObject({ status: 409 }); }
  finally { spy.mockRestore(); }
  expect((await prisma.validation.findUniqueOrThrow({ where: { id: validation.id } })).imageKey).toBeNull();
  if (!written) throw new Error("Missing staged image");
  await expect(storage.readImageFile(written)).rejects.toThrow();
});

it("keeps the job destination on retry and rejects publishing after selection changes", async () => {
  const validation = await createValidation(actor, texts);
  await prisma.validation.update({ where: { id: validation.id }, data: { imageStorageKind: "LOCAL" } });
  const sourceKey = `${randomUUID()}.png`; await writeFile(sourcePath(sourceKey), input);
  const job = await prisma.importJob.create({ data: { tenantId, validationId: validation.id, requestedById: userId, kind: "IMAGES", imageStorageKind: "LOCAL", sourceKey, originalName: "RETRY1.png" } });
  await prisma.validation.update({ where: { id: validation.id }, data: { imageStorageKind: null } });
  await processImport(job.id);
  expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
  expect(await prisma.recordImage.count({ where: { validationId: validation.id } })).toBe(0);
  const staged = await prisma.importImageItem.findFirstOrThrow({ where: { jobId: job.id } });
  expect(staged.storageKey).toMatch(/^v1:LOCAL:/);
  await prisma.validation.update({ where: { id: validation.id }, data: { imageStorageKind: "LOCAL" } });
  await processImport(job.id);
  expect((await prisma.recordImage.findFirstOrThrow({ where: { validationId: validation.id } })).storageKey).toBe(staged.storageKey);
});

it("imports and replaces record images in their captured destination and serves public grants", async () => {
  const validation = await createValidation(actor, texts);
  await prisma.$executeRaw`UPDATE "Validation" SET "imageStorageKind"='LOCAL' WHERE id=${validation.id}::uuid`;
  const sourceKey = `${randomUUID()}.png`; await writeFile(sourcePath(sourceKey), input);
  const job = await prisma.importJob.create({ data: { tenantId, validationId: validation.id, requestedById: userId, kind: "IMAGES", imageStorageKind: "LOCAL", sourceKey, originalName: "AB1.png" } });
  await processImport(job.id);
  expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETED");
  const image = await prisma.recordImage.findFirstOrThrow({ where: { validationId: validation.id } });
  expect(image.storageKey).toMatch(/^v1:LOCAL:/);
  await replaceRecordImage(actor, validation.id, image.id, input, "AB1.png", "image/png", image.updatedAt.toISOString());
  const replaced = await prisma.recordImage.findUniqueOrThrow({ where: { id: image.id } });
  expect(replaced.storageKey).toMatch(/^v1:LOCAL:/);
  await expect(storage.readImageFile(image.storageKey)).rejects.toThrow();
  const dataset = await prisma.dataset.create({ data: { tenantId, validationId: validation.id, status: "PUBLISHED" } });
  await prisma.folio.create({ data: { tenantId, validationId: validation.id, datasetId: dataset.id, folio: "1", alfanum: "AB1", alfanumNormalized: "AB1" } });
  await prisma.validation.update({ where: { id: validation.id }, data: { activeDatasetId: dataset.id } });
  await setValidationStatus(actor, validation.id, "ACTIVE");
  const viewer = "a".repeat(64), result = await verifyAlfanum(validation.publicToken, "AB1", viewer);
  if (!result?.found || !result.image) throw new Error("Missing public image");
  expect(await publicImage(result.image.grant, viewer)).toEqual(await storage.readImageFile(replaced.storageKey));
});
