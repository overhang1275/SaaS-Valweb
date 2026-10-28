import "dotenv/config";
import { confirmAction, selectTab } from "./ui-helpers";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { hash } from "argon2";
import sharp from "sharp";
import { chromium, type Page } from "playwright";

const databaseUrl = process.env.TEST_DATABASE_URL;
assert(databaseUrl && new URL(databaseUrl).pathname === "/valweb_test", "Use only the disposable valweb_test database");
process.env.DATABASE_URL = databaseUrl;
const { prisma } = await import("../../src/lib/prisma");
const base = process.env.E2E_BASE_URL || "http://localhost:3001";
const run = randomBytes(6).toString("hex");
const password = randomBytes(24).toString("hex");
const ids = { admin: randomUUID(), a: randomUUID(), b: randomUUID(), tenantA: randomUUID(), tenantB: randomUUID() };
const emails = { admin: `validations-admin-${run}@example.test`, a: `validations-a-${run}@example.test`, b: `validations-b-${run}@example.test` };
const name = `Constancias de participación ${run}`;
const updatedName = `Constancias actualizadas ${run}`;
const otherName = `Certificados de otra cuenta ${run}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const errors: string[] = [];
const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const clientContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const otherContext = await browser.newContext();
const adminPage = await adminContext.newPage();
const clientPage = await clientContext.newPage();
const otherPage = await otherContext.newPage();
for (const page of [adminPage, clientPage, otherPage]) {
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
}
async function login(page: Page, email: string) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(`${base}/dashboard`);
}
async function create(page: Page, internalName: string, title: string, tenantId?: string) {
  await page.goto(`${base}/validaciones/nueva`);
  if (tenantId) await page.getByLabel("Cuenta del cliente").selectOption(tenantId);
  await page.getByLabel("Nombre interno", { exact: true }).fill(internalName);
  await page.getByLabel("Título público", { exact: true }).fill(title);
  await page.getByLabel("Instrucciones", { exact: true }).fill("Escribe tu folio. <script>window.__validationXss = true</script>");
  await page.getByLabel("Mensaje de éxito", { exact: true }).fill("Folio encontrado. Gracias por participar.");
  await page.getByLabel("Mensaje de error", { exact: true }).fill("Folio no registrado. Revisa el dato.");
  await page.getByLabel("Modo de imágenes", { exact: true }).selectOption("SHARED");
  await page.getByRole("button", { name: "Crear validación", exact: true }).click();
  await page.waitForURL(/\/validaciones\/[a-f0-9-]+\/editar\?creada=1/);
  await page.getByText("Validación creada. Tu enlace único ya está reservado.", { exact: true }).waitFor();
  return page.url().match(/\/validaciones\/([^/]+)\//)![1];
}

try {
  const passwordHash = await hash(password);
  await prisma.tenant.createMany({ data: [{ id: ids.tenantA, name: `Cuenta pruebas A ${run}` }, { id: ids.tenantB, name: `Cuenta pruebas B ${run}` }] });
  await prisma.user.createMany({ data: [
    { id: ids.admin, email: emails.admin, name: "Administrador de pruebas", role: "ADMIN", status: "ACTIVE", passwordHash },
    { id: ids.a, email: emails.a, name: "Equipo de constancias", role: "CLIENT", status: "ACTIVE", passwordHash, tenantId: ids.tenantA },
    { id: ids.b, email: emails.b, name: "Otro equipo", role: "CLIENT", status: "ACTIVE", passwordHash, tenantId: ids.tenantB },
  ] });
  await clientPage.goto(`${base}/validaciones`);
  await clientPage.waitForURL(`${base}/login`);
  await login(clientPage, emails.a);
  await clientPage.getByRole("link", { name: "Validaciones", exact: true }).click();
  await clientPage.getByRole("heading", { name: "Aún no hay validaciones" }).waitFor();
  const id = await create(clientPage, name, "Consulta tu constancia");
  const link = await clientPage.getByLabel(`Enlace público de ${name}`, { exact: true }).inputValue();
  const publicToken = new URL(link).pathname.split("/").pop()!;
  assert.match(publicToken, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(publicToken, id);
  await clientPage.getByRole("button", { name: `Copiar enlace de ${name}`, exact: true }).click();
  assert.equal(await clientPage.evaluate(() => navigator.clipboard.readText()), link);
  console.info("PASS: creación cliente, UUID público separado y enlace copiado");

  await selectTab(clientPage, "Registros e imágenes");
  const imageEndpoint = `${base}/api/validations/${id}/image`;
  await mkdir("docs/design-audit/screenshots", { recursive: true });
  await clientPage.setViewportSize({ width: 390, height: 844 });
  await clientPage.screenshot({ path: "docs/design-audit/screenshots/validation-image-empty-390.png", fullPage: true });
  const png = await sharp(Buffer.from('<svg width="720" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="400" fill="#fff"/><rect x="20" y="20" width="680" height="360" rx="8" fill="none" stroke="#b8336a" stroke-width="3"/><text x="360" y="155" font-family="sans-serif" font-size="30" text-anchor="middle" fill="#111827">Constancia de participación</text><text x="360" y="215" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#5f6672">Imagen de prueba de Valweb</text></svg>')).png().toBuffer();
  await clientPage.getByLabel("Seleccionar imagen", { exact: true }).setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await clientPage.getByRole("button", { name: "Cargar imagen", exact: true }).click();
  await clientPage.getByRole("alert").filter({ hasText: "No se pudo leer la imagen" }).waitFor();
  await clientPage.screenshot({ path: "docs/design-audit/screenshots/validation-image-error-390.png", fullPage: true });
  await clientPage.setViewportSize({ width: 1440, height: 900 });
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).imageKey, null);
  await clientPage.getByLabel("Seleccionar imagen", { exact: true }).setInputFiles({ name: "certificate.png", mimeType: "image/png", buffer: png });
  await clientPage.getByRole("button", { name: "Cargar imagen", exact: true }).click();
  await clientPage.getByText("Imagen guardada.", { exact: true }).waitFor();
  await clientPage.locator(".image-preview img").waitFor();
  await clientPage.waitForFunction(() => { const img = document.querySelector(".image-preview img") as HTMLImageElement; return img?.complete && img.naturalWidth > 0; });
  const firstImage = await prisma.validation.findUniqueOrThrow({ where: { id } });
  assert(firstImage.imageKey); assert.equal(firstImage.imageWidth, 720);
  assert(await clientPage.getByRole("button", { name: "Activar validación", exact: true }).isDisabled());
  const imageResponse = await clientContext.request.get(imageEndpoint);
  assert.equal(imageResponse.status(), 200);
  assert.match(imageResponse.headers()["cache-control"], /no-store/);
  assert.equal(imageResponse.headers()["content-type"], "image/webp");
  assert.equal((await otherContext.request.get(imageEndpoint)).status(), 401);
  assert.equal((await clientContext.request.delete(imageEndpoint, { headers: { Origin: "https://attacker.test" } })).status(), 403);
  assert.equal((await clientContext.request.post(`${imageEndpoint}?filename=x.png`, { data: png, headers: { Origin: "https://attacker.test", "Content-Type": "image/png" } })).status(), 403);
  const tooBig = await clientContext.request.post(`${imageEndpoint}?filename=x.png`, { data: Buffer.alloc(10 * 1024 * 1024 + 1), headers: { Origin: base, "Content-Type": "image/png" } });
  assert.equal(tooBig.status(), 413);
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).imageKey, firstImage.imageKey);
  const jpeg = await sharp(png).jpeg().toBuffer();
  const disguised = await clientContext.request.post(`${imageEndpoint}?filename=spoof.png`, { data: jpeg, headers: { Origin: base, "Content-Type": "image/png" } });
  assert.equal(disguised.status(), 400);
  await clientPage.getByLabel("Reemplazar imagen", { exact: true }).setInputFiles({ name: "replacement.jpeg", mimeType: "image/jpeg", buffer: jpeg });
  await clientPage.getByRole("button", { name: "Guardar nueva imagen", exact: true }).click();
  await clientPage.getByText("Imagen guardada.", { exact: true }).waitFor();
  await clientPage.waitForFunction(() => !(document.querySelector("#validation-image-file") as HTMLInputElement)?.files?.length);
  assert.notEqual((await prisma.validation.findUniqueOrThrow({ where: { id } })).imageKey, firstImage.imageKey);
  console.info("PASS: PNG/JPEG, rechazo de formato falso/tamaño, preview privado y CSRF HTTP");

  // Real published fixture only in valweb_test; the CSV interface belongs to a later phase.
  const dataset = await prisma.dataset.create({ data: { tenantId: ids.tenantA, validationId: id, status: "PUBLISHED", publishedAt: new Date() } });
  await prisma.folio.create({ data: { tenantId: ids.tenantA, validationId: id, datasetId: dataset.id, folio: "TEST001", alfanum: "TEST001", alfanumNormalized: "TEST001" } });
  await prisma.validation.update({ where: { id }, data: { activeDatasetId: dataset.id } });
  await clientPage.reload();
  await clientPage.getByRole("button", { name: "Activar validación", exact: true }).click();
  await clientPage.getByText("Validación activada.", { exact: true }).waitFor();
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).status, "ACTIVE");
  assert.equal((await clientContext.request.delete(imageEndpoint, { headers: { Origin: base } })).status(), 409);
  await confirmAction(clientPage, () => clientPage.getByRole("button", { name: "Eliminar imagen", exact: true }).click(), false);
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).status, "ACTIVE");
  await mkdir("docs/design-audit/screenshots", { recursive: true });
  await clientPage.screenshot({ path: "docs/design-audit/screenshots/validation-image-active-1440.png", fullPage: true });
  await confirmAction(clientPage, () => clientPage.getByRole("button", { name: "Eliminar imagen", exact: true }).click());
  await clientPage.getByText("Imagen eliminada. Si la validación estaba activa, quedó desactivada.", { exact: true }).waitFor();
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).status, "INACTIVE");
  assert.equal((await clientContext.request.get(imageEndpoint)).status(), 404);
  const webp = await sharp(png).webp().toBuffer();
  await clientPage.getByLabel("Seleccionar imagen", { exact: true }).setInputFiles({ name: "restored.webp", mimeType: "image/webp", buffer: webp });
  await clientPage.getByRole("button", { name: "Cargar imagen", exact: true }).click();
  await clientPage.getByText("Imagen guardada.", { exact: true }).waitFor();
  await clientPage.getByRole("button", { name: "Activar validación", exact: true }).click();
  await clientPage.getByText("Validación activada.", { exact: true }).waitFor();
  await confirmAction(clientPage, () => clientPage.getByRole("button", { name: "Desactivar validación", exact: true }).click());
  await clientPage.getByText("Validación desactivada.", { exact: true }).waitFor();
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).status, "INACTIVE");
  console.info("PASS: requisitos reales de activación y borrado de imagen con desactivación atómica");

  await selectTab(clientPage, "Ajustes");
  await clientPage.getByLabel("Nombre interno", { exact: true }).fill(updatedName);
  await clientPage.getByLabel("Título público", { exact: true }).fill("   ");
  await clientPage.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await clientPage.getByText("Revisa los campos indicados. Tus cambios siguen en el formulario.", { exact: true }).waitFor();
  assert.equal(await clientPage.getByLabel("Nombre interno", { exact: true }).inputValue(), updatedName);
  assert.equal(await clientPage.getByLabel("Título público", { exact: true }).getAttribute("aria-invalid"), "true");
  assert.equal(await clientPage.evaluate(() => document.activeElement?.id), "validation-title");
  await mkdir("docs/design-audit/screenshots", { recursive: true });
  await clientPage.screenshot({ path: "docs/design-audit/screenshots/validation-field-error-1440.png", fullPage: true });
  await clientPage.getByLabel("Título público", { exact: true }).fill("Consulta tu constancia actualizada");
  await clientPage.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await clientPage.getByText("Cambios guardados. El enlace público se conserva.", { exact: true }).waitFor();
  await clientPage.reload();
  assert.equal(await clientPage.getByLabel("Título público", { exact: true }).inputValue(), "Consulta tu constancia actualizada");
  assert.equal(await clientPage.getByLabel(`Enlace público de ${updatedName}`, { exact: true }).inputValue(), link);
  assert.equal(await clientPage.evaluate(() => (window as unknown as { __validationXss?: boolean }).__validationXss), undefined);
  assert((await clientPage.getByLabel("Instrucciones", { exact: true }).inputValue()).includes("<script>"));
  console.info("PASS: edición persistente, datos conservados ante errores y texto escapado");

  await selectTab(clientPage, "Apariencia");
  assert.equal(await clientPage.getByLabel("Solicitar acceso con cuenta de cliente", { exact: true }).count(), 0);
  await clientPage.getByRole("button", { name: "Activar validación", exact: true }).click();
  await clientPage.getByText("Validación activada.", { exact: true }).waitFor();
  const publicPage = `${base}/v/${publicToken}`;
  assert.equal((await otherContext.request.get(publicPage)).status(), 200);
  await login(adminPage, emails.admin);
  await adminPage.goto(`${base}/validaciones/${id}/editar?tab=apariencia`);
  await adminPage.getByLabel("Solicitar acceso con cuenta de cliente", { exact: true }).check();
  await adminPage.getByRole("button", { name: "Guardar configuración", exact: true }).click();
  await adminPage.getByText("Acceso del cliente activado. La validación conserva su estado.", { exact: true }).waitFor();
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).status, "ACTIVE");
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).requireClientAccess, true);

  await otherPage.goto(publicPage);
  await otherPage.getByRole("heading", { name: "Acceso a la consulta", exact: true }).waitFor();
  await otherPage.getByLabel("Correo electrónico", { exact: true }).fill(emails.b);
  await otherPage.getByLabel("Contraseña", { exact: true }).fill(password);
  await otherPage.getByRole("button", { name: "Continuar", exact: true }).click();
  await otherPage.getByText("El correo o la contraseña no son válidos para esta consulta.", { exact: true }).waitFor();
  assert.equal((await otherContext.request.post(`${base}/api/public/validations/${publicToken}/verify`, { data: { alfanum: "TEST001" }, headers: { Origin: base } })).status(), 401);

  await clientPage.goto(publicPage);
  await clientPage.getByLabel("Correo electrónico", { exact: true }).fill(emails.a);
  await clientPage.getByLabel("Contraseña", { exact: true }).fill(password);
  await clientPage.getByRole("button", { name: "Continuar", exact: true }).click();
  await clientPage.getByRole("heading", { name: "Consulta tu constancia actualizada", exact: true }).waitFor();
  assert.equal((await clientContext.request.post(`${base}/api/public/validations/${publicToken}/verify`, { data: { alfanum: "TEST001" }, headers: { Origin: base } })).status(), 200);
  await adminPage.getByLabel("Solicitar acceso con cuenta de cliente", { exact: true }).uncheck();
  assert.equal(await adminPage.getByLabel("Solicitar acceso con cuenta de cliente", { exact: true }).isChecked(), false);
  await adminPage.getByRole("button", { name: "Guardar configuración", exact: true }).click();
  await adminPage.getByText("Acceso del cliente desactivado. La validación conserva su estado.", { exact: true }).waitFor();
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).requireClientAccess, false);
  await otherPage.reload();
  await otherPage.getByRole("heading", { name: "Consulta tu constancia actualizada", exact: true }).waitFor();
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).status, "ACTIVE");
  console.info("PASS: acceso público configurable solo por administrador y autenticación cliente por cuenta");

  await login(otherPage, emails.b);
  assert.equal((await otherContext.request.get(imageEndpoint)).status(), 404);
  assert.equal((await otherContext.request.delete(imageEndpoint, { headers: { Origin: base, "X-Confirm-Deactivation": "true" } })).status(), 404);
  await otherPage.goto(`${base}/validaciones`);
  await otherPage.getByRole("heading", { name: "Aún no hay validaciones" }).waitFor();
  await otherPage.goto(`${base}/validaciones/${id}/editar`);
  await otherPage.getByRole("heading", { name: "Página no encontrada" }).waitFor();
  assert(!(await otherPage.locator("body").innerText()).includes(updatedName));
  await create(adminPage, otherName, "Consulta certificados", ids.tenantB);
  await adminPage.goto(`${base}/validaciones`);
  await adminPage.getByText(updatedName, { exact: true }).waitFor();
  await adminPage.getByText(otherName, { exact: true }).waitFor();
  await otherPage.goto(`${base}/validaciones`);
  await otherPage.getByText(otherName, { exact: true }).waitFor();
  assert(!(await otherPage.locator("table").innerText()).includes(updatedName));
  console.info("PASS: administrador asigna cuenta y clientes no cruzan datos");

  await clientPage.goto(`${base}/validaciones/${id}/editar`);
  await mkdir("docs/design-audit/screenshots", { recursive: true });
  await adminPage.screenshot({ path: "docs/design-audit/screenshots/validations-admin-1440.png", fullPage: true });
  for (const width of [1440, 1280, 768, 390]) {
    await clientPage.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert(await clientPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}`);
    assert.equal(await clientPage.locator(".sidebar nav").getByRole("link", { name: "Validaciones", exact: true, includeHidden: true }).getAttribute("aria-current"), "page");
    await clientPage.screenshot({ path: `docs/design-audit/screenshots/validation-edit-${width}.png`, fullPage: true });
  }
  await clientPage.goto(`${base}/validaciones`);
  await clientPage.getByRole("heading", { name: "Validaciones", exact: true }).waitFor();
  await clientPage.locator("table").waitFor();
  assert(await clientPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const scrollRegion = clientPage.getByRole("region", { name: "Validaciones; tabla con desplazamiento horizontal" });
  await scrollRegion.focus();
  await clientPage.keyboard.press("ArrowRight");
  await clientPage.waitForFunction(() => (document.querySelector(".validations-table")?.scrollLeft ?? 0) > 0);
  await scrollRegion.evaluate(element => { element.scrollLeft = 0; });
  await clientPage.screenshot({ path: "docs/design-audit/screenshots/validations-client-390.png", fullPage: true });
  console.info("PASS: formulario desktop/tablet/móvil, tabla con scroll y navegación seleccionada");

  for (const token of [publicToken, randomUUID(), "invalid"]) {
    const response = await otherPage.goto(`${base}/v/${token}`);
    assert.equal(response?.status(), 404);
    await otherPage.getByRole("heading", { name: "Validación no disponible" }).waitFor();
    assert(!(await otherPage.locator("body").innerText()).includes(updatedName));
  }
  await clientPage.goto(`${base}/validaciones/${id}/editar`);
  await selectTab(clientPage, "Ajustes");
  await clientPage.locator(".danger-disclosure > summary").click();
  await confirmAction(clientPage, () => clientPage.getByRole("button", { name: "Eliminar validación", exact: true }).click(), false);
  assert.equal((await prisma.validation.findUniqueOrThrow({ where: { id } })).status, "INACTIVE");
  await confirmAction(clientPage, () => clientPage.getByRole("button", { name: "Eliminar validación", exact: true }).click());
  await clientPage.waitForURL(`${base}/validaciones?eliminada=1`);
  await clientPage.getByRole("heading", { name: "Aún no hay validaciones" }).waitFor();
  await clientPage.screenshot({ path: "docs/design-audit/screenshots/validations-empty-390.png", fullPage: true });
  const deleted = await prisma.validation.findUniqueOrThrow({ where: { id } });
  assert.equal(deleted.status, "DELETED");
  assert.equal(deleted.imageKey, null);
  assert.equal(deleted.publicToken, publicToken);
  await clientPage.goto(`${base}/validaciones/${id}/editar`);
  await clientPage.getByRole("heading", { name: "Página no encontrada" }).waitFor();
  assert.deepEqual(errors, []);
  console.info("PASS: borradores privados, eliminación confirmada y enlace no reutilizado");
} catch (cause) {
  await mkdir("docs/design-audit/screenshots", { recursive: true });
  await clientPage.screenshot({ path: "docs/design-audit/screenshots/validation-smoke-failure.png", fullPage: true });
  console.error("Validation smoke diagnostics:", {
    errors,
    publicPage: { url: otherPage.url(), headings: await otherPage.locator("h1").allTextContents(), controls: await otherPage.locator("input").evaluateAll(elements => elements.map(element => (element as HTMLInputElement).name)) },
    controls: await clientPage.locator("input,textarea,select").evaluateAll(elements => elements.map(element => {
      const field = element as HTMLInputElement;
      return { name: field.name, valid: field.validity.valid, message: field.validationMessage, length: field.value.length };
    })),
    feedback: await clientPage.locator('[role="alert"]').allTextContents(),
  });
  throw cause;
} finally {
  await browser.close();
  const rows = await prisma.validation.findMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: [ids.admin, ids.a, ids.b] } }, { targetId: { in: rows.map(row => row.id) } }] } });
  await prisma.validationDailyStat.deleteMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } } });
  await prisma.validation.updateMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } }, data: { activeDatasetId: null } });
  await prisma.folio.deleteMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } } });
  await prisma.dataset.deleteMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } } });
  await prisma.validation.deleteMany({ where: { tenantId: { in: [ids.tenantA, ids.tenantB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.a, ids.b] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [ids.tenantA, ids.tenantB] } } });
  await prisma.$disconnect();
}
