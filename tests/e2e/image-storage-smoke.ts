import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { encode } from "next-auth/jwt";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { confirmAction, selectTab } from "./ui-helpers";

assert(process.env.TEST_DATABASE_URL && new URL(process.env.TEST_DATABASE_URL).pathname === "/valweb_test", "Use valweb_test");
assert(process.env.NEXTAUTH_SECRET);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.IMAGE_STORAGE_DIR = resolve("var/test-assets");
const { prisma } = await import("../../src/lib/prisma");
const { writeImageFile, removeImageFile, readImageFile } = await import("../../src/features/images/storage");
const tenantId = randomUUID(), adminId = randomUUID(), clientId = randomUUID(), legacyId = randomUUID();
const base = "http://localhost:3001", errors: string[] = [], previous = await prisma.imageStorageLocation.findMany();
assert.equal(await prisma.validation.count({ where: { imageStorageKind: { not: null } } }), 0, "Test storage is in use");
assert.equal(await prisma.importJob.count({ where: { imageStorageKind: { not: null } } }), 0, "Test imports use storage");
assert.equal(await prisma.recordImage.count({ where: { storageKey: { startsWith: "v1:" } } }), 0, "Test images use storage");
let temporary: string | undefined, nfs: string | undefined, legacyKey: string | undefined, profilesChanged = false;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
async function capture(page: Page, name: string) {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: overflow ${width}`);
    await page.screenshot({ path: `output/playwright/storage-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function waitForDestination(id: string, kind: "LOCAL" | "NFS") {
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await prisma.validation.findUniqueOrThrow({ where: { id }, select: { imageStorageKind: true } })).imageStorageKind === kind) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id }, select: { imageStorageKind: true } })).imageStorageKind, kind);
}
try {
  temporary = await mkdtemp(join(tmpdir(), "valweb-storage-ui-"));
  const local = join(temporary, "local"); await mkdir(local);
  if (process.env.TEST_NFS_DIR) nfs = await mkdtemp(join(process.env.TEST_NFS_DIR, ".valweb-ui-"));
  await mkdir("output/playwright", { recursive: true });
  await prisma.imageStorageLocation.deleteMany(); profilesChanged = true;
  await prisma.tenant.create({ data: { id: tenantId, name: "Storage UI fixture" } });
  await prisma.user.createMany({ data: [
    { id: adminId, role: "ADMIN", tenantId: null }, { id: clientId, role: "CLIENT", tenantId },
  ].map(user => ({ ...user, role: user.role as "ADMIN" | "CLIENT", name: "Storage UI", email: `${user.id}@example.test`, status: "ACTIVE" as const, passwordHash: "unused-test-hash" })) });
  const webp = await sharp({ create: { width: 80, height: 60, channels: 3, background: "white" } }).webp().toBuffer();
  legacyKey = await writeImageFile(webp);
  await prisma.validation.create({ data: { id: legacyId, tenantId, createdById: clientId, publicToken: randomUUID(), name: "Ubicación existente", title: "Consulta", instructions: "", successMessage: "Yes", errorMessage: "No", imageMode: "SHARED", imageKey: legacyKey } });
  const adminContext = await browser.newContext(), clientContext = await browser.newContext();
  for (const [context, userId] of [[adminContext, adminId], [clientContext, clientId]] as const) {
    await context.addCookies([{ name: "next-auth.session-token", value: await encode({ secret: process.env.NEXTAUTH_SECRET, token: { sub: userId, sessionVersion: 0 }, maxAge: 1800 }), url: base }]);
  }
  const admin = await adminContext.newPage(), client = await clientContext.newPage();
  for (const page of [admin, client]) { page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message)); }
  await admin.goto(`${base}/admin/ajustes`);
  await admin.getByRole("link", { name: "Almacenamiento", exact: true }).click();
  await admin.getByLabel("Ruta local", { exact: true }).waitFor();
  await admin.getByLabel("Ruta local", { exact: true }).fill(local);
  await admin.getByRole("button", { name: "Guardar destino local", exact: true }).click();
  await admin.locator(".storage-location").filter({ has: admin.locator("#storage-root-LOCAL") }).getByText("Destino guardado y acceso verificado.", { exact: true }).waitFor();
  await admin.getByLabel("Ruta local", { exact: true }).fill(join(process.cwd(), "public"));
  await admin.getByRole("button", { name: "Guardar destino local", exact: true }).click();
  await admin.getByRole("alert").filter({ hasText: "El almacenamiento debe estar separado" }).waitFor();
  assert.equal((await prisma.imageStorageLocation.findUniqueOrThrow({ where: { kind: "LOCAL" } })).rootPath, local);
  await admin.getByLabel("Ruta local", { exact: true }).fill(local);
  await admin.getByRole("button", { name: "Guardar destino local", exact: true }).click();
  if (nfs) {
    await admin.getByLabel("Ruta NFS", { exact: true }).fill(nfs);
    await admin.getByRole("button", { name: "Guardar destino NFS", exact: true }).click();
    await admin.locator(".storage-location").filter({ has: admin.locator("#storage-root-NFS") }).getByText("Destino guardado y acceso verificado.", { exact: true }).waitFor();
  }
  await capture(admin, "settings");
  await client.goto(`${base}/admin/ajustes`); await client.waitForURL(`${base}/dashboard`);
  await client.goto(`${base}/validaciones/nueva`);
  await client.getByLabel("Nombre interno", { exact: true }).fill("Validación local UI");
  await client.getByLabel("Título público", { exact: true }).fill("Consulta");
  await client.getByRole("button", { name: "Crear validación", exact: true }).click();
  await client.waitForURL(/\/validaciones\/[a-f0-9-]+\/editar/);
  const id = client.url().match(/\/validaciones\/([^/]+)\//)![1], editor = `${base}/validaciones/${id}/editar`;
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).imageStorageKind, "LOCAL");
  await prisma.importJob.createMany({ data: Array.from({ length: 24 }, (_, index) => ({ tenantId, validationId: id, requestedById: clientId, kind: index < 12 ? "CSV" as const : "IMAGES" as const, status: "COMPLETED" as const, sourceKey: `${randomUUID()}.zip`, originalName: index < 12 ? `records-${index}.csv` : `images-${index}.zip`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)) })) });
  await client.goto(editor + "?tab=datos");
  const records = client.getByRole("tabpanel", { name: "Registros", exact: true }); await records.waitFor();
  assert.equal(await records.locator(".import-job").count(), 10);
  assert(!(await records.innerText()).includes("images-"));
  await selectTab(client, "Imágenes");
  assert.match(client.url(), /tab=imagenes/);
  assert.equal(await client.getByRole("tabpanel", { name: "Imágenes", exact: true }).locator(".import-job").count(), 10);
  assert.equal(await client.getByLabel("Destino de las imágenes", { exact: true }).inputValue(), "LOCAL");
  await client.getByRole("button", { name: "Crear carpeta", exact: true }).click();
  await client.getByRole("button", { name: "Carpeta preparada", exact: true }).waitFor();
  assert((await readdir(join(local, `${tenantId}_${id}`))).includes("procesadas"));
  if (nfs) {
    await client.getByLabel("Destino de las imágenes", { exact: true }).selectOption("NFS");
    await client.getByRole("button", { name: "Guardar destino", exact: true }).click();
    await waitForDestination(id, "NFS");
    await client.getByRole("button", { name: "Crear carpeta", exact: true }).waitFor();
    await client.getByRole("button", { name: "Crear carpeta", exact: true }).click();
    await client.getByRole("button", { name: "Carpeta preparada", exact: true }).waitFor();
    const original = join(nfs, `${tenantId}_${id}`, "ORIGINAL.png"); await writeFile(original, webp);
    await client.getByLabel("Destino de las imágenes", { exact: true }).selectOption("LOCAL");
    await client.getByRole("button", { name: "Guardar destino", exact: true }).click();
    await waitForDestination(id, "LOCAL");
    await client.getByText("Destino seleccionado.", { exact: true }).waitFor();
    assert.deepEqual(await readFile(original), webp);
  }
  const ftpOriginal = join(local, `${tenantId}_${id}`, "por_procesar", "FTP123.webp"); await writeFile(ftpOriginal, webp); await client.reload();
  await selectTab(client, "Registros");
  await client.getByLabel("Archivo CSV", { exact: true }).setInputFiles({ name: "unsent.csv", mimeType: "text/csv", buffer: Buffer.from("folio,alfanum\n1,A1\n") });
  await selectTab(client, "Imágenes");
  const imageTab = client.getByRole("tabpanel", { name: "Imágenes", exact: true });
  await imageTab.getByText("1 imágenes", { exact: true }).waitFor();
  const started = client.waitForResponse(response => response.url().includes("/image-sync"));
  await imageTab.getByRole("button", { name: "Procesar", exact: true }).click();
  const startResponse = await started;
  assert.equal(startResponse.status(), 202, `Image sync rejected: ${await startResponse.text()}`);
  const ftpJob = client.locator(".import-job").filter({ hasText: "Actualización FTP" });
  let ftpResult = await prisma.importJob.findFirst({ where: { validationId: id, originalName: "Actualización FTP" }, orderBy: { createdAt: "desc" } });
  for (let attempt = 0; attempt < 60 && ftpResult && !["COMPLETED", "FAILED"].includes(ftpResult.status); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    ftpResult = await prisma.importJob.findFirst({ where: { validationId: id, originalName: "Actualización FTP" }, orderBy: { createdAt: "desc" } });
  }
  assert.equal(ftpResult?.status, "COMPLETED", `FTP job ended as ${ftpResult?.status}: ${ftpResult?.phase} ${ftpResult?.error ?? ""}`);
  await ftpJob.getByText("Completado", { exact: true }).waitFor({ timeout: 10000 });
  const ftpImage = await prisma.recordImage.findUniqueOrThrow({ where: { tenantId_validationId_alfanumNormalized: { tenantId, validationId: id, alfanumNormalized: "FTP123" } } });
  assert(ftpImage.storageKey.startsWith("v1:LOCAL:")); assert((await readImageFile(ftpImage.storageKey)).length > 0);
  await assert.rejects(readFile(ftpOriginal), { code: "ENOENT" });
  if (nfs) {
    const nfsValidationId = randomUUID();
    await prisma.validation.create({ data: { id: nfsValidationId, tenantId, createdById: clientId, publicToken: randomUUID(), name: "NFS FTP", title: "Consulta NFS", instructions: "", successMessage: "Yes", errorMessage: "No", imageMode: "PER_RECORD", imageStorageKind: "NFS" } });
    const nfsClient = await clientContext.newPage(); nfsClient.setDefaultTimeout(30000); nfsClient.on("pageerror", error => errors.push(error.message));
    await nfsClient.goto(`${base}/validaciones/${nfsValidationId}/editar?tab=imagenes`);
    await nfsClient.getByRole("button", { name: "Crear carpeta", exact: true }).click();
    await nfsClient.getByRole("button", { name: "Carpeta preparada", exact: true }).waitFor();
    const nfsOriginal = join(nfs!, `${tenantId}_${nfsValidationId}`, "por_procesar", "NFS123.png");
    const firstNfsImage = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#1122aa" } }).png().toBuffer();
    await writeFile(nfsOriginal, firstNfsImage); await nfsClient.reload();
    const nfsTab = nfsClient.getByRole("tabpanel", { name: "Imágenes", exact: true });
    await nfsTab.getByText("1 imágenes", { exact: true }).waitFor();
    const nfsStarted = nfsClient.waitForResponse(response => response.url().includes("/image-sync"));
    await nfsTab.getByRole("button", { name: "Procesar", exact: true }).click(); await nfsStarted;
    let nfsJob = await prisma.importJob.findFirst({ where: { validationId: nfsValidationId, originalName: "Actualización FTP" }, orderBy: { createdAt: "desc" } });
    for (let attempt = 0; attempt < 60 && nfsJob && !["COMPLETED", "FAILED"].includes(nfsJob.status); attempt++) { await new Promise(resolve => setTimeout(resolve, 500)); nfsJob = await prisma.importJob.findFirst({ where: { validationId: nfsValidationId, originalName: "Actualización FTP" }, orderBy: { createdAt: "desc" } }); }
    assert.equal(nfsJob?.status, "COMPLETED", `NFS FTP import ended as ${nfsJob?.status}: ${nfsJob?.phase} ${nfsJob?.error ?? ""}`);
    const firstNfsRecord = await prisma.recordImage.findUniqueOrThrow({ where: { tenantId_validationId_alfanumNormalized: { tenantId, validationId: nfsValidationId, alfanumNormalized: "NFS123" } } });
    assert(firstNfsRecord.storageKey.startsWith("v1:NFS:")); assert((await readImageFile(firstNfsRecord.storageKey)).length > 0);
    await assert.rejects(readFile(nfsOriginal), { code: "ENOENT" });

    const replacement = await sharp({ create: { width: 81, height: 60, channels: 3, background: "#aa1122" } }).png().toBuffer();
    await writeFile(nfsOriginal, replacement); await nfsClient.reload();
    const reviewTab = nfsClient.getByRole("tabpanel", { name: "Imágenes", exact: true }); await reviewTab.getByText("1 imágenes", { exact: true }).waitFor();
    const replacementStart = nfsClient.waitForResponse(response => response.url().includes("/image-sync"));
    await reviewTab.getByRole("button", { name: "Procesar", exact: true }).click(); await replacementStart;
    let reviewJob = await prisma.importJob.findFirst({ where: { validationId: nfsValidationId, originalName: "Actualización FTP" }, orderBy: { createdAt: "desc" } });
    for (let attempt = 0; attempt < 60 && reviewJob?.status !== "REVIEW" && reviewJob?.status !== "FAILED"; attempt++) { await new Promise(resolve => setTimeout(resolve, 500)); reviewJob = await prisma.importJob.findFirst({ where: { validationId: nfsValidationId, originalName: "Actualización FTP" }, orderBy: { createdAt: "desc" } }); }
    assert.equal(reviewJob?.status, "REVIEW", `NFS replacement ended as ${reviewJob?.status}: ${reviewJob?.phase} ${reviewJob?.error ?? ""}`);
    const review = nfsClient.locator(".import-job").filter({ hasText: "Actualización FTP" }).first(); await review.getByText("Reemplazos por confirmar", { exact: true }).waitFor();
    assert.deepEqual(await readFile(nfsOriginal), replacement);
    const publish = nfsClient.waitForResponse(response => response.url().includes(`/api/imports/`) && response.request().method() === "POST");
    await confirmAction(nfsClient, () => review.getByRole("button", { name: "Publicar nuevas y reemplazar existentes", exact: true }).click());
    await publish;
    const replaced = await prisma.recordImage.findUniqueOrThrow({ where: { tenantId_validationId_alfanumNormalized: { tenantId, validationId: nfsValidationId, alfanumNormalized: "NFS123" } } });
    assert(replaced.storageKey.startsWith("v1:NFS:")); assert.notEqual(replaced.storageKey, firstNfsRecord.storageKey);
    assert.equal(replaced.sourceHash, createHash("sha256").update(replacement).digest("hex")); assert((await readImageFile(replaced.storageKey)).length > 0);
    await assert.rejects(readFile(nfsOriginal), { code: "ENOENT" });
  }
  assert(!(await client.content()).includes(local));
  if (nfs) assert(!(await client.content()).includes(nfs));
  assert.equal(await client.getByRole("link", { name: "Configurar destinos globales" }).count(), 0);
  assert.equal(await client.evaluate(() => { const ids = [...document.querySelectorAll("[id]")].map(node => node.id); return ids.length - new Set(ids).size; }), 0);
  for (const kind of ["CSV", "IMAGES"]) {
    const response = await client.request.get(`${base}/api/validations/${id}/imports?kind=${kind}`);
    assert.equal(response.status(), 200); const jobs = await response.json(); assert.equal(jobs.length, 10); assert(jobs.every((job: { kind: string }) => job.kind === kind));
  }
  assert.equal((await client.request.get(`${base}/api/validations/${id}/imports?kind=INVALID`)).status(), 400);
  await capture(client, "images");
  await selectTab(client, "Registros");
  assert.equal(await client.getByLabel("Archivo CSV", { exact: true }).evaluate(input => (input as HTMLInputElement).files?.[0]?.name), "unsent.csv");
  await client.goto(editor + "?tab=imagenes");
  await client.goto(`${base}/validaciones/${id}/imagenes`);
  assert.equal(await client.getByRole("link", { name: "Cargar imágenes", exact: true }).first().getAttribute("href"), `/validaciones/${id}/editar?tab=imagenes`);
  await client.goto(`${base}/validaciones/${legacyId}/editar?tab=imagenes`);
  await client.getByText("Almacenamiento existente", { exact: true }).waitFor();
  assert.equal(await client.getByLabel("Destino de las imágenes", { exact: true }).count(), 0);
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id: legacyId } })).imageKey, legacyKey);
  const legacyImage = await client.request.get(`${base}/api/validations/${legacyId}/image`);
  assert.equal(legacyImage.status(), 200); assert.deepEqual(await legacyImage.body(), webp);
  const failed = await prisma.importJob.create({ data: { tenantId, validationId: id, requestedById: clientId, kind: "IMAGES", status: "FAILED", sourceKey: `${randomUUID()}.zip`, originalName: "failed-images.zip" } });
  await client.goto(editor + "?tab=imagenes");
  const failedPanel = client.locator(".import-job").filter({ hasText: "failed-images.zip" });
  await confirmAction(client, () => failedPanel.getByRole("button", { name: "Cancelar importación", exact: true }).click());
  await failedPanel.getByText("Cancelado", { exact: true }).waitFor();
  assert.equal((await prisma.importJob.findUniqueOrThrow({ where: { id: failed.id } })).status, "CANCELLED");
  assert.deepEqual(errors, []);
  console.log(`PASS: global forms, local default, separate histories, FTP publication and cleanup, private paths, folders, legacy images and mobile${nfs ? ", real NFS FTP replacement review" : " (NFS not enabled)"}`);
} finally {
  await browser.close().catch(() => undefined);
  const where = { tenantId };
  await prisma.validationDailyStat.deleteMany({ where }); await prisma.importJob.deleteMany({ where }); await prisma.recordImage.deleteMany({ where });
  await prisma.validation.updateMany({ where, data: { activeDatasetId: null } }); await prisma.folio.deleteMany({ where }); await prisma.dataset.deleteMany({ where }); await prisma.validation.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, clientId] } } });
  await prisma.rateLimitBucket.deleteMany({ where: { OR: [{ key: { contains: adminId } }, { key: { contains: clientId } }] } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, clientId] } } }); await prisma.tenant.deleteMany({ where: { id: tenantId } });
  if (profilesChanged) { await prisma.imageStorageLocation.deleteMany(); if (previous.length) await prisma.imageStorageLocation.createMany({ data: previous }); }
  if (legacyKey) await removeImageFile(legacyKey);
  await prisma.$disconnect();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  if (nfs) await rm(nfs, { recursive: true, force: true });
}
