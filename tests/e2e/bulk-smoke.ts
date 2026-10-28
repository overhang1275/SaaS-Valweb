import "dotenv/config";
import { confirmAction, selectTab } from "./ui-helpers";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { hash } from "argon2";
import sharp from "sharp";
import { chromium, type Page } from "playwright";
assert(process.env.TEST_DATABASE_URL && new URL(process.env.TEST_DATABASE_URL).pathname === "/valweb_test");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { prisma } = await import("../../src/lib/prisma");
const { removeImageFile } = await import("../../src/features/images/storage");
process.env.IMAGE_STORAGE_DIR = join(process.cwd(), "var/test-assets");
const tenantId = randomUUID(), userId = randomUUID();
const password = randomBytes(24).toString("hex"), email = `bulk-${userId}@example.test`;
const temporary = await mkdtemp(join(tmpdir(), "valweb-browser-bulk-"));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage(), publicPage = await browser.newPage();
page.setDefaultTimeout(30000); publicPage.setDefaultTimeout(30000);
const errors: string[] = [];
for (const target of [page, publicPage]) target.on("pageerror", error => errors.push(error.message));
const base = "http://localhost:3001";
async function screenshot(target: Page, name: string) {
  await target.locator(".loading-state").waitFor({ state: "hidden" });
  await target.waitForLoadState("networkidle");
  await target.evaluate(() => window.scrollTo(0, 0));
  await target.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await target.screenshot({ path: `output/playwright/${name}.png`, fullPage: true, style: "nextjs-portal { display: none; }" });
}
async function jobReady(id: string, kind: "CSV" | "IMAGES", candidate = false) {
  for (let attempt = 0; attempt < 240; attempt++) {
    const job = await prisma.importJob.findFirst({ where: { validationId: id, kind }, orderBy: { createdAt: "desc" } });
    if (job?.status === "FAILED") throw new Error(`Import failed: ${job.error}`);
    if (job && (kind === "IMAGES" ? job.status === "COMPLETED" : job.status === "REVIEW" && (!candidate || job.candidateDatasetId))) return job;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Worker timeout");
}
try {
  await prisma.tenant.create({ data: { id: tenantId, name: "Carga masiva de prueba" } });
  await prisma.user.create({ data: { id: userId, tenantId, email, name: "Operador", role: "CLIENT", status: "ACTIVE", passwordHash: await hash(password) } });
  const png = await sharp(Buffer.from('<svg width="720" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="400" fill="#fff"/><rect x="18" y="18" width="684" height="364" fill="none" stroke="#b8336a" stroke-width="3"/><text x="360" y="170" font-family="sans-serif" font-size="28" text-anchor="middle">Constancia de participación</text><text x="360" y="225" font-family="sans-serif" font-size="20" text-anchor="middle">Folio 0001 · 4frs5</text></svg>')).png().toBuffer();
  await writeFile(join(temporary, "sample.png"), png);
  execFileSync("python3", ["-c", `import zipfile,sys,os
root=sys.argv[1]
png=open(os.path.join(root,'sample.png'),'rb').read()
with zipfile.ZipFile(os.path.join(root,'imagenes.zip'),'w',zipfile.ZIP_STORED) as z:
 for i in range(1000): z.writestr(('4frs5' if i==0 else f'CODE{i}')+'.png',png)`, temporary]);
  const csv = "folio,alfanum,tipo,tro\n" + Array.from({ length: 1000 }, (_, i) => `${String(i + 1).padStart(4, "0")},${i === 0 ? "4frs5" : `CODE${i}`},Constancia,Campo privado\n`).join("");
  await page.goto(`${base}/login`);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click(); await page.waitForURL(`${base}/dashboard`);
  await page.goto(`${base}/validaciones/nueva`);
  await page.getByLabel("Nombre interno", { exact: true }).fill("Constancias de participación");
  await page.getByLabel("Título público", { exact: true }).fill("Consulta tu constancia");
  await page.getByRole("button", { name: "Crear validación", exact: true }).click(); await page.waitForURL(/\/validaciones\/[a-f0-9-]+\/editar/);
  const id = page.url().match(/\/validaciones\/([^/]+)\//)![1], editUrl = `${base}/validaciones/${id}/editar`;
  await selectTab(page, "Registros e imágenes");
  await page.getByLabel("Archivo CSV", { exact: true }).setInputFiles({ name: "registros.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Subir archivo", exact: true }).click();
  await jobReady(id, "CSV"); await page.reload();
  await page.getByLabel("Alfanumérico de búsqueda", { exact: true }).selectOption("alfanum");
  await page.getByLabel("Folio que se mostrará", { exact: true }).selectOption("folio");
  await page.getByRole("button", { name: "Analizar archivo completo", exact: true }).click();
  await jobReady(id, "CSV", true); await page.reload();
  await confirmAction(page, () => page.getByRole("button", { name: "Publicar base revisada", exact: true }).click());
  await page.getByText("Base publicada", { exact: true }).waitFor();
  assert(await page.getByRole("button", { name: "Activar validación", exact: true }).isDisabled());
  await page.getByLabel("Tipo de carga", { exact: true }).selectOption("IMAGES");
  await page.getByLabel("Archivo ZIP o imagen", { exact: true }).setInputFiles(join(temporary, "imagenes.zip"));
  await page.getByRole("button", { name: "Subir archivo", exact: true }).click();
  const imagesJob = await jobReady(id, "IMAGES");
  assert.equal(imagesJob.processed, 1000);
  assert.equal(await prisma.recordImage.count({ where: { validationId: id } }), 1000);
  await page.reload(); await page.getByRole("button", { name: "Activar validación", exact: true }).click();
  await page.getByRole("button", { name: "Desactivar validación", exact: true }).waitFor();
  const statistics = page.getByRole("region", { name: "Estadísticas", exact: true });
  async function checkStatistics(expected: { records: string; queries: string; found: string; notFound: string }) {
    for (const [label, value] of [["Registros publicados", expected.records], ["Consultas", expected.queries], ["Encontrados", expected.found], ["No encontrados", expected.notFound]]) {
      const field = statistics.getByText(label, { exact: true }).locator("..").locator("dd");
      await field.filter({ hasText: new RegExp(`^${value}$`) }).waitFor();
      assert.equal(await field.innerText(), value, label);
    }
  }
  await checkStatistics({ records: "1,000", queries: "0", found: "0", notFound: "0" });
  console.info("PASS: navegador CSV → mapeo → publicación → ZIP 1,000 imágenes → worker → activación");
  await mkdir("output/playwright", { recursive: true });
  await screenshot(page, "bulk-edit-1440");
  const validation = await prisma.validation.findUniqueOrThrow({ where: { id } });
  await publicPage.goto(`${base}/v/${validation.publicToken}`);
  await publicPage.getByLabel("Alfanumérico", { exact: true }).fill("4frs5");
  await publicPage.getByRole("button", { name: "Consultar", exact: true }).click();
  await publicPage.getByText("0001", { exact: true }).waitFor();
  await publicPage.waitForFunction(() => { const image = document.querySelector<HTMLCanvasElement>('.document-canvas[data-state="ready"]'); return image?.dataset.imageWidth === "720"; });
  assert.equal(await publicPage.locator(".public-record-fields").getByText("Constancia", { exact: true }).count(), 1);
  await screenshot(publicPage, "bulk-public-1440");
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await screenshot(publicPage, "bulk-public-390");
  assert(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await publicPage.getByLabel("Alfanumérico", { exact: true }).fill("DOESNOTEXIST"); await publicPage.getByRole("button", { name: "Consultar", exact: true }).click();
  await publicPage.locator(".public-result .feedback.error").waitFor();
  assert.equal(await publicPage.locator(".document-canvas").count(), 0);
  await selectTab(page, "Apariencia");
  await page.getByRole("checkbox", { name: "Otros", exact: true }).uncheck();
  await page.getByRole("button", { name: "Guardar configuración", exact: true }).click();
  await page.getByRole("button", { name: "Activar validación", exact: true }).waitFor();
  await page.getByRole("button", { name: "Activar validación", exact: true }).click();
  await page.getByRole("button", { name: "Desactivar validación", exact: true }).waitFor();
  await publicPage.reload();
  const responseWait = publicPage.waitForResponse(response => response.url().includes("/verify"));
  await publicPage.getByLabel("Alfanumérico", { exact: true }).fill("4frs5"); await publicPage.getByRole("button", { name: "Consultar", exact: true }).click();
  const body = await (await responseWait).json(); assert(!JSON.stringify(body).includes("Campo privado"));
  await selectTab(page, "Resumen");
  await page.getByRole("button", { name: "Actualizar estadísticas", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await checkStatistics({ records: "1,000", queries: "3", found: "2", notFound: "1" });
  await statistics.screenshot({ path: "output/playwright/statistics-1440.png", style: "nextjs-portal { display: none; }" });
  await page.setViewportSize({ width: 768, height: 900 });
  await statistics.screenshot({ path: "output/playwright/statistics-768.png", style: "nextjs-portal { display: none; }" });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 390, height: 844 });
  await statistics.screenshot({ path: "output/playwright/statistics-390.png", style: "nextjs-portal { display: none; }" });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  console.info("PASS: estadísticas reales 1,000 registros, 3 consultas, 2 encontrados, 1 no encontrado; actualización y tres anchos");
  await page.goto(`${base}/validaciones/${id}/imagenes`);
  await page.getByRole("link", { name: "Página siguiente (superior)", exact: true }).waitFor();
  assert.equal(await page.locator(".catalog-item").count(), 50);
  await page.getByLabel("Buscar en catálogo", { exact: true }).fill("4frs5"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.waitForURL(/search=4frs5/); assert.equal(await page.locator(".catalog-item").count(), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Imágenes por alfanumérico", exact: true }).waitFor();
  await screenshot(page, "bulk-gallery-390");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.goto(editUrl); await page.getByRole("heading", { name: "Constancias de participación", exact: true }).waitFor(); await screenshot(page, "bulk-edit-390");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
  console.info("PASS: búsqueda 4frs5 → 0001 + imagen, error sin imagen, campos privados omitidos, catálogo paginado y móvil sin desborde");
} catch (cause) {
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/bulk-failure.png", fullPage: true });
  console.error({ errors, alerts: await page.getByRole("alert").allTextContents() }); throw cause;
} finally {
  await browser.close();
  const where = { tenantId };
  const images = await prisma.recordImage.findMany({ where, select: { storageKey: true } });
  await prisma.validationDailyStat.deleteMany({ where }); await prisma.importJob.deleteMany({ where }); await prisma.recordImage.deleteMany({ where });
  await prisma.validation.updateMany({ where, data: { activeDatasetId: null } });
  await prisma.folio.deleteMany({ where }); await prisma.dataset.deleteMany({ where }); await prisma.validation.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where: { actorId: userId } }); await prisma.user.deleteMany({ where: { id: userId } }); await prisma.tenant.delete({ where: { id: tenantId } });
  for (const image of images) await removeImageFile(image.storageKey);
  await prisma.$disconnect(); await rm(temporary, { recursive: true, force: true });
}
