import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.hoisted(() => {
  if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname !== "/valweb_test") throw new Error("Use valweb_test");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});
vi.mock("../../src/lib/auth", () => ({ getActor: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/prisma";
import { createValidation } from "../../src/features/validations/service";
import { listRecordImages, replaceRecordImage, getRecordImage, deleteRecordImage } from "../../src/features/records/images";
import { DEFAULT_CATALOG_QUERY } from "../../src/features/records/catalog-query";
import { readImageFile, writeImageFile } from "../../src/features/images/storage";
import { verifyAlfanum, publicImage } from "../../src/features/public/service";
import type { Actor } from "../../src/features/identity/service";
import { getActor } from "../../src/lib/auth";
import { GET, POST, DELETE } from "../../src/app/api/validations/[id]/images/[imageId]/route";

const tenantId = randomUUID(), userId = randomUUID(), foreignTenant = randomUUID(), foreignUser = randomUUID();
const actor: Actor = { id: userId, role: "CLIENT", tenantId, sessionVersion: 0 };
const foreign: Actor = { id: foreignUser, role: "CLIENT", tenantId: foreignTenant, sessionVersion: 0 };
const viewer = "a".repeat(64);
let directory: string, validationId: string, token: string, datasetId: string, imageId: string, png: Buffer;
const query = (options = {}) => listRecordImages(actor, validationId, { ...DEFAULT_CATALOG_QUERY, ...options });
const context = () => ({ params: Promise.resolve({ id: validationId, imageId }) });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "valweb-catalog-test-"));
  vi.stubEnv("IMAGE_STORAGE_DIR", join(directory, "images")); vi.stubEnv("NEXTAUTH_URL", "http://localhost:3001");
  await prisma.tenant.createMany({ data: [{ id: tenantId, name: "Catalog test" }, { id: foreignTenant, name: "Other" }] });
  await prisma.user.createMany({ data: [actor, foreign].map(user => ({ id: user.id, tenantId: user.tenantId, email: `${user.id}@example.test`, name: "Test", role: "CLIENT" as const, status: "ACTIVE" as const, passwordHash: "unused-test-hash" })) });
  const validation = await createValidation(actor, { name: "Catalog", title: "Consulta", instructions: "Código", successMessage: "Encontrado", errorMessage: "No existe" });
  validationId = validation.id; token = validation.publicToken;
  const dataset = await prisma.dataset.create({ data: { tenantId, validationId, status: "PUBLISHED", recordCount: 2 } }); datasetId = dataset.id;
  await prisma.folio.createMany({ data: [{ tenantId, validationId, datasetId, alfanum: "Ab1", alfanumNormalized: "AB1", folio: "0001", tipo: "Diploma" },
    { tenantId, validationId, datasetId, alfanum: "Ab2", alfanumNormalized: "AB2", folio: "0002", tipo: "Constancia" }] });
  await prisma.validation.update({ where: { id: validationId }, data: { activeDatasetId: datasetId, status: "ACTIVE" } });
  png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#002a45" } }).png().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  const storageKey = await writeImageFile(webp), orphanKey = await writeImageFile(webp);
  const image = await prisma.recordImage.create({ data: { tenantId, validationId, alfanumNormalized: "AB1", originalName: "Ab1.png", storageKey, width: 800, height: 400, size: webp.length, createdAt: new Date("2026-10-27T06:00:00Z") } }); imageId = image.id;
  await prisma.recordImage.create({ data: { tenantId, validationId, alfanumNormalized: "ORPHAN", originalName: "Orphan.png", storageKey: orphanKey, width: 800, height: 400, size: webp.length, createdAt: new Date("2026-10-28T06:00:00Z") } });
  vi.mocked(getActor).mockResolvedValue(actor);
});
afterAll(async () => {
  const where = { tenantId: { in: [tenantId, foreignTenant] } };
  await prisma.validationDailyStat.deleteMany({ where }); await prisma.importJob.deleteMany({ where }); await prisma.recordImage.deleteMany({ where });
  await prisma.validation.updateMany({ where, data: { activeDatasetId: null } });
  await prisma.folio.deleteMany({ where }); await prisma.dataset.deleteMany({ where }); await prisma.validation.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [userId, foreignUser] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, foreignUser] } } }); await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignTenant] } } });
  await prisma.$disconnect(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true });
});
it("joins the published dataset with images, filters real states and preserves folio zeroes", async () => {
  const all = await query();
  expect(all.total).toBe(3); expect(all.types).toEqual(["Constancia", "Diploma"]);
  expect(all.rows.map(row => [row.alfanum, row.folio, row.state])).toEqual([["Ab1", "0001", "linked"], ["Ab2", "0002", "missing"], ["ORPHAN", null, "orphan"]]);
  for (const state of ["linked", "missing", "orphan"]) expect((await query({ state })).total).toBe(1);
  expect((await query({ search: "ab" })).total).toBe(2);
  expect((await query({ searchBy: "folio", search: "0001" })).rows[0].folio).toBe("0001");
  expect((await query({ searchBy: "filename", search: "aB1" })).total).toBe(1);
  expect((await query({ searchBy: "filename", search: "%" })).total).toBe(0);
  expect((await query({ tipo: "Diploma" })).total).toBe(1);
  expect((await query({ from: "2026-10-27", until: "2026-10-27" })).rows.map(row => row.state)).toEqual(["linked"]);
  expect((await query({ from: "2026-10-28", until: "2026-10-28" })).rows.map(row => row.state)).toEqual(["orphan"]);
  expect((await query({ state: "missing", from: "2026-10-27" })).total).toBe(0);
  expect((await query({ page: 999999 })).page).toBe(1);
  await expect(listRecordImages(foreign, validationId)).rejects.toThrow();
  expect(JSON.stringify(all)).not.toContain("storageKey");
});
it("tracks dataset replacement and never shows retired folio metadata", async () => {
  const next = await prisma.dataset.create({ data: { tenantId, validationId, status: "PUBLISHED" } });
  await prisma.validation.update({ where: { id: validationId }, data: { activeDatasetId: next.id } });
  const replaced = await query(); expect(replaced.total).toBe(2); expect(replaced.rows.every(row => row.state === "orphan" && row.folio === null)).toBe(true);
  await prisma.validation.update({ where: { id: validationId }, data: { activeDatasetId: null } });
  expect((await query()).rows.every(row => row.state === "orphan")).toBe(true);
  await prisma.validation.update({ where: { id: validationId }, data: { activeDatasetId: datasetId } });
});
it("rejects invalid replacements without losing the prior file or relation", async () => {
  const old = (await getRecordImage(actor, validationId, imageId))!;
  const original = await readImageFile(old.storageKey);
  await expect(replaceRecordImage(foreign, validationId, imageId, png, "new.png", "image/png", old.updatedAt.toISOString())).rejects.toThrow();
  await expect(replaceRecordImage(actor, validationId, imageId, png, "new.jpeg", "image/jpeg", old.updatedAt.toISOString())).rejects.toThrow();
  await expect(replaceRecordImage(actor, validationId, imageId, Buffer.from("broken"), "new.png", "image/png", old.updatedAt.toISOString())).rejects.toThrow();
  await expect(replaceRecordImage(actor, validationId, imageId, png, "new.png", "image/png", "2020-01-01T00:00:00.000Z")).rejects.toThrow(/cambió/);
  expect((await getRecordImage(actor, validationId, imageId))!.storageKey).toBe(old.storageKey);
  expect(await readImageFile(old.storageKey)).toEqual(original);
});
it("atomically replaces file, preserves association and active state, revokes old image grant", async () => {
  const old = (await getRecordImage(actor, validationId, imageId))!;
  const result = await verifyAlfanum(token, "Ab1", viewer);
  if (!result?.found || !result.image) throw new Error("Expected image");
  expect(await publicImage(result.image.grant, viewer)).not.toBeNull();
  await replaceRecordImage(actor, validationId, imageId, png, "replacement.png", "image/png", old.updatedAt.toISOString());
  const next = (await getRecordImage(actor, validationId, imageId))!;
  expect(next.alfanumNormalized).toBe(old.alfanumNormalized); expect(next.storageKey).not.toBe(old.storageKey);
  expect(next.updatedAt.getTime()).toBeGreaterThan(old.updatedAt.getTime());
  expect(await publicImage(result.image.grant, viewer)).toBeNull();
  await expect(readImageFile(old.storageKey)).rejects.toThrow();
  expect((await prisma.validation.findUniqueOrThrow({ where: { id: validationId } })).status).toBe("ACTIVE");
  expect(await prisma.auditLog.count({ where: { tenantId, action: "RECORD_IMAGE_REPLACED" } })).toBe(1);
  await expect(replaceRecordImage(actor, validationId, imageId, png, "new.png", "image/png", old.updatedAt.toISOString())).rejects.toThrow(/cambió/);
});
it("serves private bounded thumbnails and rejects unauthenticated, foreign-origin or stale requests", async () => {
  const url = `http://localhost:3001/api/validations/${validationId}/images/${imageId}`;
  vi.mocked(getActor).mockResolvedValue(null);
  expect((await GET(new Request(url), context())).status).toBe(401);
  vi.mocked(getActor).mockResolvedValue(foreign);
  expect((await GET(new Request(url), context())).status).toBe(404);
  vi.mocked(getActor).mockResolvedValue(actor);
  const response = await GET(new Request(`${url}?thumbnail=1`), context());
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  expect(metadata.width).toBe(320); expect(metadata.height).toBe(160);
  const data = { method: "POST", headers: { origin: "http://evil.test", "content-type": "image/png" }, body: new Uint8Array(png) };
  expect((await POST(new Request(`${url}?filename=new.png`, data), context())).status).toBe(403);
  expect((await POST(new Request(`${url}?filename=new.png`, { ...data, headers: { origin: "http://localhost:3001", "content-type": "image/png" } }), context())).status).toBe(400);
  expect((await POST(new Request(`${url}?filename=new.png`, { ...data, headers: { origin: "http://localhost:3001", "content-type": "image/png", "x-image-version": "2020-01-01T00:00:00.000Z" } }), context())).status).toBe(409);
  expect((await DELETE(new Request(url, { method: "DELETE", headers: { origin: "http://localhost:3001" } }), context())).status).toBe(409);
});
it("keeps a 50k-image catalog bounded and clamps deep pages", async () => {
  await prisma.$executeRaw`INSERT INTO "RecordImage" (id,"tenantId","validationId","alfanumNormalized","originalName","storageKey",width,height,size,"createdAt","updatedAt")
    SELECT gen_random_uuid(), ${tenantId}::uuid, ${validationId}::uuid, 'BENCH' || lpad(n::text,5,'0'), 'bench.png', gen_random_uuid()::text || '.webp',800,400,1024,now(),now() FROM generate_series(1,50000) n`;
  const measurements: number[] = [];
  for (const page of [1, 500, 1000, 999999]) {
    const start = performance.now();
    const catalog = await query({ page });
    measurements.push(Math.round(performance.now() - start));
    expect(catalog.rows.length).toBeLessThanOrEqual(50); expect(catalog.total).toBe(50003);
    expect(catalog.page).toBeLessThanOrEqual(1001);
  }
  console.info("Catalog50k server list durations(ms):", measurements);
  await prisma.recordImage.deleteMany({ where: { tenantId, validationId, alfanumNormalized: { startsWith: "BENCH" } } });
});
it("retains delete confirmation and deactivation behavior", async () => {
  await expect(deleteRecordImage(actor, validationId, imageId, false)).rejects.toThrow(/Confirma/);
  await deleteRecordImage(actor, validationId, imageId, true);
  expect((await prisma.validation.findUniqueOrThrow({ where: { id: validationId } })).status).toBe("INACTIVE");
  expect((await query({ state: "missing" })).total).toBe(2);
});
