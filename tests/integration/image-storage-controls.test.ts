import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../../src/lib/prisma";
import { saveGlobalImageLocation, selectValidationImageStorage, getGlobalImageLocations, getValidationImageStorage, createValidationImageFolder } from "../../src/features/images/locations";
import { writeImageFile, lockImageLocation } from "../../src/features/images/storage";
import { currentActor } from "../../src/features/identity/service";
import * as validationService from "../../src/features/validations/service";
import { cancelImport, listImports } from "../../src/features/imports/service";
import type { Actor } from "../../src/features/identity/service";
import type { Prisma } from "../../src/generated/prisma/client";

let directory: string;
const rollback = new Error("Rollback image controls fixture");
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "valweb-storage-controls-")); });
afterAll(async () => { vi.restoreAllMocks(); await prisma.$disconnect(); await rm(directory, { recursive: true, force: true }); });

async function fixture(tx: Prisma.TransactionClient) {
  const root = join(directory, randomUUID()); await mkdir(root);
  const tenant = await tx.tenant.create({ data: { name: "Storage controls" } });
  const admin = await tx.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Admin", role: "ADMIN", status: "ACTIVE", passwordHash: "unused-test-hash" } });
  const client = await tx.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Client", role: "CLIENT", status: "ACTIVE", tenantId: tenant.id, passwordHash: "unused-test-hash" } });
  const validation = await tx.validation.create({ data: { tenantId: tenant.id, createdById: client.id, publicToken: randomUUID(), name: "Controls", title: "Consulta", instructions: "", successMessage: "Yes", errorMessage: "No" } });
  const actors = { admin: { id: admin.id, role: "ADMIN", tenantId: null, sessionVersion: 0 }, client: { id: client.id, role: "CLIENT", tenantId: tenant.id, sessionVersion: 0 } } satisfies Record<string, Actor>;
  return { root, validation, actors };
}

// Services keep their own transaction boundary; route it into this rollback-only fixture.
async function withFixture(check: (value: Awaited<ReturnType<typeof fixture>>, tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(prisma.$transaction(async tx => {
    const value = await fixture(tx);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(async callback => {
      if (typeof callback !== "function") throw new Error("Expected interactive transaction");
      return callback(tx);
    });
    try { await check(value, tx); } finally { spy.mockRestore(); }
    throw rollback;
  }, { timeout: 15000 })).rejects.toBe(rollback);
}

it("allows only an authenticated administrator to configure a probed root and audits the change", async () => {
  await withFixture(async ({ root, actors }, tx) => {
    await expect(saveGlobalImageLocation(actors.client, { kind: "LOCAL", rootPath: root })).rejects.toThrow();
    await saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: root });
    expect((await tx.imageStorageLocation.findUniqueOrThrow({ where: { kind: "LOCAL" } })).rootPath).toBe(root);
    expect(await readdir(root)).toEqual([]);
    expect(await tx.auditLog.count({ where: { actorId: actors.admin.id, action: "IMAGE_STORAGE_CONFIGURED" } })).toBe(1);
  });
});

it("rejects relative, hidden-character, code, configuration and import roots", async () => {
  await withFixture(async ({ actors }) => {
    for (const rootPath of ["relative/path", "/tmp/invisible\u200b", process.cwd(), "/etc/valweb", join(process.cwd(), "public"), process.env.IMPORT_STORAGE_DIR || join(process.cwd(), "var/imports")]) {
      await expect(saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath })).rejects.toThrow();
    }
  });
});

it("rejects overlapping roots and symlinks without changing configuration", async () => {
  await withFixture(async ({ root, actors }, tx) => {
    const nested = join(root, "nested"); await mkdir(nested);
    await tx.imageStorageLocation.upsert({ where: { kind: "NFS" }, create: { kind: "NFS", rootPath: root }, update: { rootPath: root } });
    await expect(saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: nested })).rejects.toThrow();
    const link = join(directory, randomUUID()); await symlink(root, link);
    await expect(saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: link })).rejects.toThrow();
  });
});

it("rejects unavailable NFS and cannot redirect a root once its validation folder exists", async () => {
  await withFixture(async ({ root, validation, actors }, tx) => {
    await expect(saveGlobalImageLocation(actors.admin, { kind: "NFS", rootPath: root })).rejects.toThrow(/NFS/);
    await saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: root });
    await writeImageFile(Buffer.from("processed"), { kind: "LOCAL", tenantId: validation.tenantId, validationId: validation.id });
    const folder = join(root, `${validation.tenantId}_${validation.id}`);
    const original = join(folder, "ABC.png"); await writeFile(original, "FTP original");
    const replacement = join(directory, randomUUID()); await mkdir(replacement);
    await expect(saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: replacement })).rejects.toMatchObject({ status: 409 });
    expect((await tx.imageStorageLocation.findUniqueOrThrow({ where: { kind: "LOCAL" } })).rootPath).toBe(root);
    expect(await readFile(original, "utf8")).toBe("FTP original");
  });
});

it.skipIf(process.getuid?.() === 0)("rejects a root that the service cannot write", async () => {
  await withFixture(async ({ root, actors }) => {
    await chmod(root, 0o500);
    try { await expect(saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: root })).rejects.toThrow(); }
    finally { await chmod(root, 0o700); }
  });
});

it("selects only configured destinations within the client's own validation and blocks images or jobs", async () => {
  await withFixture(async ({ root, validation, actors }, tx) => {
    await saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: root });
    await selectValidationImageStorage(actors.client, validation.id, "LOCAL");
    expect((await tx.validation.findUniqueOrThrow({ where: { id: validation.id } })).imageStorageKind).toBe("LOCAL");
    const foreign = await tx.tenant.create({ data: { name: "Foreign" } });
    const forged = { ...actors.client, tenantId: foreign.id, role: "ADMIN" as const };
    await expect(saveGlobalImageLocation(forged, { kind: "LOCAL", rootPath: root })).rejects.toThrow();
    const foreignValidation = await tx.validation.create({ data: { tenantId: foreign.id, createdById: actors.admin.id, publicToken: randomUUID(), name: "Foreign", title: "Consulta", instructions: "", successMessage: "Yes", errorMessage: "No" } });
    await expect(selectValidationImageStorage(actors.client, foreignValidation.id, "LOCAL")).rejects.toThrow();
    await expect(selectValidationImageStorage(actors.client, validation.id, "NFS")).rejects.toThrow();
    await tx.validation.update({ where: { id: validation.id }, data: { imageStorageKind: null, imageKey: `${randomUUID()}.webp` } });
    await expect(selectValidationImageStorage(actors.client, validation.id, "LOCAL")).rejects.toMatchObject({ status: 409 });
    await tx.validation.update({ where: { id: validation.id }, data: { imageKey: null } });
    await tx.recordImage.create({ data: { tenantId: validation.tenantId, validationId: validation.id, alfanumNormalized: "A1", originalName: "A1.png", storageKey: `${randomUUID()}.webp`, width: 1, height: 1, size: 1 } });
    await expect(selectValidationImageStorage(actors.client, validation.id, "LOCAL")).rejects.toMatchObject({ status: 409 });
    await tx.recordImage.deleteMany({ where: { validationId: validation.id } });
    await tx.importJob.create({ data: { tenantId: validation.tenantId, validationId: validation.id, requestedById: actors.client.id, kind: "IMAGES", sourceKey: `${randomUUID()}.zip`, originalName: "pending.zip" } });
    await expect(selectValidationImageStorage(actors.client, validation.id, "LOCAL")).rejects.toMatchObject({ status: 409 });
    await tx.importJob.updateMany({ where: { validationId: validation.id }, data: { status: "FAILED" } });
    await expect(selectValidationImageStorage(actors.client, validation.id, "LOCAL")).rejects.toMatchObject({ status: 409 });
    const failed = await tx.importJob.findFirstOrThrow({ where: { validationId: validation.id } });
    await cancelImport(actors.client, failed.id);
    expect((await tx.importJob.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("CANCELLED");
    await selectValidationImageStorage(actors.client, validation.id, "LOCAL");
  });
});

it("protects referenced roots even when their validation folder is missing", async () => {
  await withFixture(async ({ root, validation, actors }, tx) => {
    await saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: root });
    const replacement = join(directory, randomUUID()); await mkdir(replacement);
    const key = `v1:LOCAL:${validation.tenantId}_${validation.id}:${randomUUID()}.webp`;
    await tx.validation.update({ where: { id: validation.id }, data: { imageKey: key } });
    await expect(saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: replacement })).rejects.toMatchObject({ status: 409 });
    await tx.validation.update({ where: { id: validation.id }, data: { imageKey: null } });
    await tx.recordImage.create({ data: { tenantId: validation.tenantId, validationId: validation.id, alfanumNormalized: "A1", originalName: "A1.png", storageKey: key, width: 1, height: 1, size: 1 } });
    await expect(saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: replacement })).rejects.toMatchObject({ status: 409 });
    await tx.recordImage.deleteMany({ where: { validationId: validation.id } });
    await tx.importJob.create({ data: { tenantId: validation.tenantId, validationId: validation.id, requestedById: actors.client.id, kind: "IMAGES", imageStorageKind: "LOCAL", status: "COMPLETED", sourceKey: `${randomUUID()}.zip`, originalName: "completed.zip" } });
    await expect(saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: replacement })).rejects.toMatchObject({ status: 409 });
  });
});

it("uses the upload lock order during a concurrent destination selection", async () => {
  const previous = await prisma.imageStorageLocation.findUnique({ where: { kind: "LOCAL" } });
  const { root, validation, actors } = await prisma.$transaction(tx => fixture(tx));
  let selectionAttempted!: () => void, uploadLocked!: () => void;
  const selectionReached = new Promise<void>(resolve => { selectionAttempted = resolve; });
  const uploadReached = new Promise<void>(resolve => { uploadLocked = resolve; });
  const lockValidation = validationService.lockValidation;
  const spy = vi.spyOn(validationService, "lockValidation").mockImplementation(async (tx, user, id) => {
    if (id === validation.id) selectionAttempted();
    return lockValidation(tx, user, id);
  });
  try {
    await prisma.imageStorageLocation.upsert({ where: { kind: "LOCAL" }, create: { kind: "LOCAL", rootPath: root }, update: { rootPath: root } });
    await prisma.validation.update({ where: { id: validation.id }, data: { imageStorageKind: "LOCAL" } });
    const upload = prisma.$transaction(async tx => {
      const user = await currentActor(tx, actors.client);
      await lockValidation(tx, user, validation.id);
      uploadLocked();
      await selectionReached;
      await lockImageLocation(tx, "LOCAL");
    });
    await uploadReached;
    const selection = selectValidationImageStorage(actors.admin, validation.id, "LOCAL");
    const results = await Promise.allSettled([upload, selection]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
  } finally {
    spy.mockRestore();
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [actors.admin.id, actors.client.id] } } });
    await prisma.validation.delete({ where: { id: validation.id } });
    await prisma.user.deleteMany({ where: { id: { in: [actors.admin.id, actors.client.id] } } });
    await prisma.tenant.delete({ where: { id: validation.tenantId } });
    if (previous) await prisma.imageStorageLocation.update({ where: { kind: "LOCAL" }, data: { rootPath: previous.rootPath } });
    else await prisma.imageStorageLocation.delete({ where: { kind: "LOCAL" } });
  }
});

it("creates the validation folder idempotently, preserves originals and hides server paths from clients", async () => {
  await withFixture(async ({ root, validation, actors }) => {
    await saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: root });
    await selectValidationImageStorage(actors.client, validation.id, "LOCAL");
    const before = await getValidationImageStorage(actors.client, validation.id);
    expect(before.folderState).toBe("missing");
    expect(before.fullPath).toBeUndefined();
    expect(JSON.stringify(before)).not.toContain(root);
    await expect(getGlobalImageLocations(actors.client)).rejects.toThrow();
    await expect(getGlobalImageLocations({ ...actors.client, role: "ADMIN" })).rejects.toThrow();
    const path = join(root, `${validation.tenantId}_${validation.id}`);
    await mkdir(path);
    await mkdir(join(path, "por_procesar"));
    await createValidationImageFolder(actors.client, validation.id);
    expect((await stat(path)).mode & 0o2777).toBe(0o2770);
    expect((await stat(join(path, "por_procesar"))).mode & 0o2777).toBe(0o2770);
    expect((await stat(join(path, "procesadas"))).mode & 0o777).toBe(0o700);
    await writeFile(join(path, "A1.png"), "FTP original");
    await createValidationImageFolder(actors.client, validation.id);
    expect(await readFile(join(path, "A1.png"), "utf8")).toBe("FTP original");
    expect((await getValidationImageStorage(actors.client, validation.id)).folderState).toBe("ready");
    expect((await getValidationImageStorage(actors.admin, validation.id)).fullPath).toBe(path);
    expect((await getValidationImageStorage({ ...actors.client, role: "ADMIN" }, validation.id)).fullPath).toBeUndefined();
    expect((await getGlobalImageLocations(actors.admin)).find(row => row.kind === "LOCAL")).toMatchObject({ rootPath: root, configured: true, available: true });
  });
});

it("does not create folders before selection or follow an existing symlink", async () => {
  await withFixture(async ({ root, validation, actors }) => {
    await expect(createValidationImageFolder(actors.client, validation.id)).rejects.toThrow();
    await saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: root });
    await selectValidationImageStorage(actors.client, validation.id, "LOCAL");
    const outside = join(directory, randomUUID()); await mkdir(outside);
    await symlink(outside, join(root, `${validation.tenantId}_${validation.id}`));
    expect((await getValidationImageStorage(actors.client, validation.id)).folderState).toBe("unavailable");
    await expect(createValidationImageFolder(actors.client, validation.id)).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });
});

it("filters each import history in the database before limiting it to ten jobs", async () => {
  await withFixture(async ({ validation, actors }, tx) => {
    await tx.importJob.createMany({ data: Array.from({ length: 24 }, (_, index) => ({
      tenantId: validation.tenantId, validationId: validation.id, requestedById: actors.client.id,
      kind: index < 12 ? "CSV" as const : "IMAGES" as const, sourceKey: `${randomUUID()}.zip`, originalName: `job-${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    })) });
    const csv = await listImports(actors.client, validation.id, "CSV"), images = await listImports(actors.client, validation.id, "IMAGES");
    expect(csv).toHaveLength(10); expect(csv.every(job => job.kind === "CSV")).toBe(true);
    expect(images).toHaveLength(10); expect(images.every(job => job.kind === "IMAGES")).toBe(true);
    expect(csv[0].originalName).toBe("job-11"); expect(images[0].originalName).toBe("job-23");
    expect(await listImports(actors.client, validation.id)).toHaveLength(10);
  });
});

it("defaults new validations to configured local storage without reassigning existing validations", async () => {
  await withFixture(async ({ root, validation, actors }, tx) => {
    await saveGlobalImageLocation(actors.admin, { kind: "LOCAL", rootPath: root });
    const created = await validationService.createValidation(actors.client, { name: "New local validation", title: "Consulta", instructions: "", successMessage: "Yes", errorMessage: "No" });
    expect(created.imageStorageKind).toBe("LOCAL");
    expect((await tx.validation.findUniqueOrThrow({ where: { id: validation.id } })).imageStorageKind).toBeNull();
    const second = await validationService.createValidation(actors.client, { name: "Another local validation", title: "Consulta", instructions: "", successMessage: "Yes", errorMessage: "No" });
    for (const [row, content] of [[created, "A"], [second, "B"]] as const) {
      const key = await writeImageFile(Buffer.from(content), { kind: "LOCAL", tenantId: row.tenantId, validationId: row.id });
      await tx.recordImage.create({ data: { tenantId: row.tenantId, validationId: row.id, alfanumNormalized: "DUP1", originalName: "DUP1.png", storageKey: key, width: 1, height: 1, size: 1 } });
      expect(await readFile(join(root, `${row.tenantId}_${row.id}`, "procesadas", key.split(":").at(-1)!))).toEqual(Buffer.from(content));
    }
    expect(await tx.recordImage.count({ where: { validationId: { in: [created.id, second.id] }, alfanumNormalized: "DUP1" } })).toBe(2);
  });
});
