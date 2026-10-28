import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || new URL(url).pathname !== "/valweb_test") throw new Error("Use only valweb_test");
  process.env.DATABASE_URL = url;
});
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/prisma";
import type { Actor } from "../../src/features/identity/service";
import { createValidation, deleteValidation, setValidationStatus } from "../../src/features/validations/service";
import { replaceValidationImage, deleteValidationImage } from "../../src/features/images/service";
import { readImageFile } from "../../src/features/images/storage";

const tenantId = randomUUID(), otherTenantId = randomUUID(), userId = randomUUID(), otherId = randomUUID();
const actor: Actor = { id: userId, tenantId, role: "CLIENT", sessionVersion: 0 };
const other: Actor = { id: otherId, tenantId: otherTenantId, role: "CLIENT", sessionVersion: 0 };
const texts = { imageMode: "SHARED" as const, name: "Image test", title: "Title", instructions: "", successMessage: "Yes", errorMessage: "No" };
let directory: string, input: Buffer;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "valweb-image-db-")); vi.stubEnv("IMAGE_STORAGE_DIR", directory);
  input = await sharp({ create: { width: 240, height: 120, channels: 3, background: "#b8336a" } }).png().toBuffer();
  await prisma.tenant.createMany({ data: [{ id: tenantId, name: "Image first" }, { id: otherTenantId, name: "Image second" }] });
  await prisma.user.createMany({ data: [
    { id: userId, email: `${userId}@example.test`, name: "Images", tenantId, role: "CLIENT", status: "ACTIVE", passwordHash: "unused-test-hash" },
    { id: otherId, email: `${otherId}@example.test`, name: "Other", tenantId: otherTenantId, role: "CLIENT", status: "ACTIVE", passwordHash: "unused-test-hash" },
  ] });
});
afterAll(async () => {
  await prisma.validation.updateMany({ where: { tenantId: { in: [tenantId, otherTenantId] } }, data: { activeDatasetId: null } });
  await prisma.folio.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.dataset.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.validation.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [userId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.$disconnect(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true });
});
it("keeps the previous image on failed replacement and removes it only after a valid commit", async () => {
  const validation = await createValidation(actor, texts);
  await replaceValidationImage(actor, validation.id, input, "certificate.png", "image/png");
  const first = await prisma.validation.findUniqueOrThrow({ where: { id: validation.id } });
  expect(first.imageWidth).toBe(240); expect(first.imageHeight).toBe(120);
  expect(first.imageMime).toBe("image/webp");
  await expect(replaceValidationImage(actor, validation.id, Buffer.from("bad"), "bad.png", "image/png")).rejects.toThrow();
  expect((await prisma.validation.findUniqueOrThrow({ where: { id: validation.id } })).imageKey).toBe(first.imageKey);
  expect((await readImageFile(first.imageKey!)).length).toBeGreaterThan(0);
  await replaceValidationImage(actor, validation.id, input, "replacement.png", "image/png");
  const second = await prisma.validation.findUniqueOrThrow({ where: { id: validation.id } });
  expect(second.imageKey).not.toBe(first.imageKey);
  await expect(readImageFile(first.imageKey!)).rejects.toThrow();
  expect((await readdir(directory)).includes(second.imageKey!)).toBe(true);
  expect(await prisma.auditLog.count({ where: { targetId: validation.id, action: "VALIDATION_IMAGE_REPLACED" } })).toBe(2);
});
it("denies foreign and revoked actors without writing files", async () => {
  const validation = await createValidation(other, texts);
  const before = await readdir(directory);
  await expect(replaceValidationImage({ ...actor, role: "ADMIN", tenantId: otherTenantId }, validation.id, input, "x.png", "image/png")).rejects.toThrow();
  await expect(deleteValidationImage(actor, validation.id, true)).rejects.toThrow();
  expect(await readdir(directory)).toEqual(before);
});
it("requires confirmation to remove an active image and atomically deactivates", async () => {
  const validation = await createValidation(actor, texts);
  await replaceValidationImage(actor, validation.id, input, "x.png", "image/png");
  const dataset = await prisma.dataset.create({ data: { tenantId, validationId: validation.id, status: "PUBLISHED", publishedAt: new Date() } });
  await prisma.folio.create({ data: { tenantId, validationId: validation.id, datasetId: dataset.id, folio: "A1", alfanum: "A1", alfanumNormalized: "A1" } });
  await prisma.validation.update({ where: { id: validation.id }, data: { activeDatasetId: dataset.id } });
  await setValidationStatus(actor, validation.id, "ACTIVE");
  await expect(deleteValidationImage(actor, validation.id, false)).rejects.toThrow();
  const active = await prisma.validation.findUniqueOrThrow({ where: { id: validation.id } });
  expect(active.status).toBe("ACTIVE"); expect(active.imageKey).not.toBeNull();
  await deleteValidationImage(actor, validation.id, true);
  const inactive = await prisma.validation.findUniqueOrThrow({ where: { id: validation.id } });
  expect(inactive.status).toBe("INACTIVE"); expect(inactive.imageKey).toBeNull();
  await expect(readImageFile(active.imageKey!)).rejects.toThrow();
});
it("serializes concurrent replacements and deleting validation removes its file", async () => {
  const validation = await createValidation(actor, texts);
  await Promise.all([replaceValidationImage(actor, validation.id, input, "a.png", "image/png"), replaceValidationImage(actor, validation.id, input, "b.png", "image/png")]);
  const saved = await prisma.validation.findUniqueOrThrow({ where: { id: validation.id } });
  expect((await readImageFile(saved.imageKey!)).length).toBeGreaterThan(0);
  await deleteValidation(actor, validation.id);
  await expect(readImageFile(saved.imageKey!)).rejects.toThrow();
});
it("keeps a committed image when the database loses the commit acknowledgement", async () => {
  const validation = await createValidation(actor, texts);
  await replaceValidationImage(actor, validation.id, input, "first.png", "image/png");
  const transaction = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, "$transaction")
    .mockImplementationOnce(transaction)
    .mockImplementationOnce(async (...args) => {
      await Reflect.apply(transaction, prisma, args);
      throw new Error("Commit acknowledgement lost");
    });
  try {
    await expect(replaceValidationImage(actor, validation.id, input, "second.png", "image/png")).rejects.toThrow("Commit acknowledgement lost");
    const committed = await prisma.validation.findUniqueOrThrow({ where: { id: validation.id } });
    expect((await readImageFile(committed.imageKey!)).length).toBeGreaterThan(0);
  } finally { spy.mockRestore(); }
});
