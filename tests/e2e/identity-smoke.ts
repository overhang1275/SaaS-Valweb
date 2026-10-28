import "dotenv/config";
import { confirmAction } from "./ui-helpers";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { hash } from "argon2";
import { SMTPServer } from "smtp-server";
import { chromium, type Page } from "playwright";

// Never run browser fixtures against the development or production database.
const databaseUrl = process.env.TEST_DATABASE_URL;
assert(databaseUrl && new URL(databaseUrl).pathname === "/valweb_test", "A dedicated valweb_test database is required");
process.env.DATABASE_URL = databaseUrl;
const { prisma } = await import("../../src/lib/prisma");
const base = "http://localhost:3001";
const run = randomBytes(6).toString("hex");
const password = randomBytes(20).toString("hex");
const newPassword = randomBytes(20).toString("hex");
const adminEmail = `browser-admin-${run}@example.test`;
const emailA = `browser-a-${run}@example.test`;
const emailB = `browser-b-${run}@example.test`;
const tenantA = `Prueba de acceso A ${run}`;
const tenantB = `Prueba de acceso B ${run}`;
const mail: Array<{ recipients: string[]; body: string }> = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["AUTH", "STARTTLS"],
  logger: false,
  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => {
      mail.push({ recipients: session.envelope.rcptTo.map(recipient => recipient.address), body: Buffer.concat(chunks).toString("utf8") });
      callback();
    });
    stream.on("error", callback);
  },
});
await new Promise<void>((resolve, reject) => { smtp.on("error", reject); smtp.listen(2525, "127.0.0.1", resolve); });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const errors: string[] = [];
const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const adminPage = await adminContext.newPage();
adminPage.on("pageerror", error => errors.push(error.message));

async function visible(page: Page, text: string) {
  await page.getByText(text, { exact: true }).waitFor({ timeout: 20000 });
}
async function login(page: Page, email: string, secret: string) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(`${base}/dashboard`, { timeout: 20000 });
}
async function receivedToken(email: string, previous?: string) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const latest = mail.findLast(item => item.recipients.includes(email));
    if (latest && (!previous || !latest.body.replace(/=\r?\n/g, "").includes(previous))) break;
    await delay(100);
  }
  const message = mail.findLast(item => item.recipients.includes(email));
  assert(message, "Expected a locally captured email");
  const token = message.body.replace(/=\r?\n/g, "").match(/[a-f0-9]{64}/)?.[0];
  assert(token, "Expected an access token in email");
  return token;
}
async function setPassword(page: Page, token: string, secret: string) {
  await page.goto(`${base}/establecer-password?token=${token}`);
  await page.getByLabel("Nueva contraseña", { exact: true }).fill(secret);
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Guardar contraseña", exact: true }).click();
  await visible(page, "Contraseña guardada. Ya puedes iniciar sesión.");
}

try {
  await prisma.user.create({ data: { email: adminEmail, name: "Pruebas de acceso", role: "ADMIN", status: "ACTIVE", passwordHash: await hash(password) } });
  await adminPage.goto(`${base}/admin/clientes`);
  await adminPage.waitForURL(`${base}/login`);
  await login(adminPage, adminEmail, password);
  for (const name of [tenantA, tenantB]) {
    await adminPage.goto(`${base}/admin/clientes`);
    await adminPage.getByRole("tab", { name: "Crear cuenta", exact: true }).click();
    await adminPage.getByLabel("Nombre de la cuenta").fill(name);
    await adminPage.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    await adminPage.getByRole("tab", { name: "Listado", exact: true }).click();
    await visible(adminPage, name);
  }
  for (const [name, email, tenant] of [["Usuario de cuenta A", emailA, tenantA], ["Usuario de cuenta B", emailB, tenantB]]) {
    await adminPage.goto(`${base}/admin/usuarios`);
    await adminPage.getByRole("tab", { name: "Invitar usuario", exact: true }).click();
    await adminPage.getByLabel("Nombre", { exact: true }).fill(name);
    await adminPage.getByLabel("Correo electrónico", { exact: true }).fill(email);
    await adminPage.getByLabel("Cuenta", { exact: true }).selectOption({ label: tenant });
    await adminPage.getByRole("button", { name: "Enviar invitación", exact: true }).click();
    await visible(adminPage, "Invitación enviada. El enlace vence en 48 horas.");
  }
  console.info("PASS: login, creación de cuentas e invitación SMTP local");
  const clientContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const clientPage = await clientContext.newPage();
  clientPage.on("pageerror", error => errors.push(error.message));
  const previousInvitation = await receivedToken(emailA);
  await adminPage.goto(`${base}/admin/usuarios`);
  await adminPage.getByRole("row").filter({ hasText: emailA }).getByRole("button", { name: "Reenviar invitación", exact: true }).click();
  await visible(adminPage, "Invitación enviada. El enlace vence en 48 horas.");
  const invitation = await receivedToken(emailA, previousInvitation);
  assert.notEqual(invitation, previousInvitation);
  await clientPage.goto(`${base}/establecer-password?token=${previousInvitation}`);
  await visible(clientPage, "Este enlace ya no está disponible");
  await setPassword(clientPage, invitation, password);
  await clientPage.goto(`${base}/establecer-password?token=${invitation}`);
  await visible(clientPage, "Este enlace ya no está disponible");
  await login(clientPage, emailA, password);
  await clientPage.goto(`${base}/admin/usuarios`);
  const tableText = await clientPage.locator("table").innerText();
  assert(tableText.includes(emailA));
  assert(!tableText.includes(emailB) && !tableText.includes(adminEmail));
  assert.equal(await clientPage.getByRole("button", { name: "Enviar invitación" }).count(), 0);
  await clientPage.goto(`${base}/admin/clientes`);
  await clientPage.waitForURL(`${base}/dashboard`);
  console.info("PASS: activación, enlace de un solo uso y aislamiento en navegador");
  const recoveryContext = await browser.newContext();
  const recoveryPage = await recoveryContext.newPage();
  await recoveryPage.goto(`${base}/recuperar-acceso`);
  await recoveryPage.getByLabel("Correo electrónico").fill(emailA);
  await recoveryPage.getByRole("button", { name: "Enviar enlace", exact: true }).click();
  await visible(recoveryPage, "Si el correo tiene acceso activo, recibirás un enlace para establecer una nueva contraseña.");
  const reset = await receivedToken(emailA, invitation);
  assert.notEqual(reset, invitation);
  await setPassword(recoveryPage, reset, newPassword);
  await clientPage.goto(`${base}/dashboard`);
  await clientPage.waitForURL(`${base}/login`);
  await login(clientPage, emailA, newPassword);
  console.info("PASS: recuperación por correo local y revocación de sesión anterior");
  await adminPage.goto(`${base}/admin/usuarios`);
  await adminPage.getByRole("heading", { name: "Usuarios", exact: true }).waitFor();
  await adminPage.locator("table").waitFor();
  const userRow = adminPage.getByRole("row").filter({ hasText: emailA });
  await confirmAction(adminPage, () => userRow.getByRole("button", { name: "Desactivar", exact: true }).click());
  await visible(adminPage, "Acceso actualizado. Las sesiones anteriores se revocaron.");
  await clientPage.goto(`${base}/dashboard`);
  await clientPage.waitForURL(`${base}/login`);
  await adminPage.goto(`${base}/admin/usuarios`);
  await adminPage.getByRole("row").filter({ hasText: emailA }).getByRole("button", { name: "Activar", exact: true }).click();
  await visible(adminPage, "Acceso actualizado. Las sesiones anteriores se revocaron.");
  await clientPage.goto(`${base}/dashboard`);
  await clientPage.waitForURL(`${base}/login`);
  await login(clientPage, emailA, newPassword);
  await adminPage.goto(`${base}/admin/clientes`);
  await confirmAction(adminPage, () => adminPage.getByRole("row").filter({ hasText: tenantA }).getByRole("button", { name: "Suspender", exact: true }).click());
  await visible(adminPage, "Cuenta suspendida. Se revocó el acceso de sus usuarios.");
  await clientPage.goto(`${base}/dashboard`);
  await clientPage.waitForURL(`${base}/login`);
  console.info("PASS: desactivación, reactivación y suspensión sin restaurar JWT antiguos");
  await mkdir("docs/design-audit/screenshots", { recursive: true });
  await adminPage.screenshot({ path: "docs/design-audit/screenshots/admin-clients-1440.png", fullPage: true });
  await adminPage.goto(`${base}/admin/usuarios`);
  await adminPage.getByRole("heading", { name: "Usuarios", exact: true }).waitFor();
  await adminPage.locator("table").waitFor();
  await adminPage.screenshot({ path: "docs/design-audit/screenshots/admin-users-1440.png", fullPage: true });
  await adminPage.setViewportSize({ width: 390, height: 844 });
  assert(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page must not overflow on mobile");
  await adminPage.screenshot({ path: "docs/design-audit/screenshots/admin-users-390.png", fullPage: true });
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.info("PASS: responsive del panel y ausencia de errores de JavaScript");
} finally {
  await browser.close();
  await new Promise<void>(resolve => smtp.close(resolve));
  const users = await prisma.user.findMany({ where: { email: { in: [adminEmail, emailA, emailB] } }, select: { id: true } });
  const tenants = await prisma.tenant.findMany({ where: { name: { in: [tenantA, tenantB] } }, select: { id: true } });
  const ids = [...users, ...tenants].map(item => item.id);
  await prisma.validation.deleteMany({ where: { tenantId: { in: tenants.map(tenant => tenant.id) } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users.map(user => user.id) } }, { targetId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants.map(tenant => tenant.id) } } });
  await prisma.$disconnect();
}
