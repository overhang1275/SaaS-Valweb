import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { hash } from "argon2";
import { SMTPServer } from "smtp-server";
import { chromium, type Browser } from "playwright";

const databaseUrl = process.env.TEST_DATABASE_URL;
assert(databaseUrl && new URL(databaseUrl).pathname === "/valweb_test", "Use a disposable valweb_test database");
process.env.DATABASE_URL = databaseUrl;
const base = process.env.SMTP_SETTINGS_BASE_URL || "http://localhost:3001";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Use the local test server");
const { prisma } = await import("../../src/lib/prisma");
const original = await prisma.smtpSettings.findUnique({ where: { id: 1 } });
const run = randomUUID(), adminId = randomUUID(), clientId = randomUUID(), tenantId = randomUUID();
const password = randomBytes(24).toString("hex"), smtpPassword = randomBytes(24).toString("hex");
const smtpUser = `smtp-${run}@example.test`;
const captured: Array<{ recipients: string[]; body: string; secure: boolean }> = [];
const smtp = new SMTPServer({
  key: await readFile("output/playwright/mail-settings/smtp-key.pem"),
  cert: await readFile("output/playwright/mail-settings/smtp-cert.pem"),
  logger: false,
  onAuth(auth, _session, callback) {
    if (auth.username !== smtpUser || auth.password !== smtpPassword) return callback(new Error("Invalid test credentials"));
    callback(null, { user: smtpUser });
  },
  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => {
      captured.push({ recipients: session.envelope.rcptTo.map(recipient => recipient.address), body: Buffer.concat(chunks).toString("utf8"), secure: session.secure });
      callback();
    });
    stream.on("error", callback);
  },
});
let browser: Browser | undefined;
try {
  await new Promise<void>((resolve, reject) => { smtp.once("error", reject); smtp.listen(2525, "127.0.0.1", resolve); });
  const passwordHash = await hash(password);
  await prisma.tenant.create({ data: { id: tenantId, name: `SMTP browser ${run}` } });
  await prisma.user.createMany({ data: [
    { id: adminId, email: `smtp-admin-${run}@example.test`, name: "Administrador de correo", role: "ADMIN", status: "ACTIVE", passwordHash },
    { id: clientId, email: `smtp-client-${run}@example.test`, name: "Cliente SMTP", role: "CLIENT", status: "ACTIVE", passwordHash, tenantId },
  ] });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/login`);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(`smtp-admin-${run}@example.test`);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(`${base}/dashboard`);
  await page.goto(`${base}/admin/ajustes?seccion=notificaciones`);
  await page.getByRole("heading", { name: "Correo electrónico", exact: true }).waitFor();
  const field = (name: string) => page.getByLabel(name, { exact: true });
  await field("Servidor SMTP").fill("127.0.0.1");
  await field("Puerto SMTP").fill("2525");
  await field("Remitente").fill("Valweb SMTP <sender@example.test>");
  await field("Usuario SMTP").fill(smtpUser);
  await field("Contraseña SMTP").fill(smtpPassword);
  await delay(10500);
  assert.equal(await field("Remitente").inputValue(), "Valweb SMTP <sender@example.test>", "System refresh must preserve unsaved input");
  assert.equal(await field("Contraseña SMTP").inputValue(), smtpPassword);
  async function submit(name: string) {
    const [response] = await Promise.all([
      page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/admin/ajustes")),
      page.getByRole("button", { name, exact: true }).click(),
    ]);
    await response.finished();
  }
  await submit("Guardar configuración");
  await page.getByText("Configuración de correo guardada. Se aplicará a los próximos envíos.", { exact: true }).waitFor();
  console.log("PASS browser save");
  const stored = await prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } });
  assert.equal(stored.host, "127.0.0.1");
  assert.equal(stored.port, 2525);
  assert.notEqual(stored.encryptedPassword, smtpPassword);
  const response = await page.reload();
  const html = await response!.text();
  assert(!html.includes(smtpPassword), "Plaintext credentials must not be serialized");
  assert(!html.includes(stored.encryptedPassword!), "Encrypted credentials must not be serialized");
  assert.equal(await field("Contraseña SMTP").inputValue(), "");
  await field("Remitente").fill("Valweb SMTP <updated@example.test>");
  await submit("Guardar configuración");
  assert.equal((await prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } })).encryptedPassword, stored.encryptedPassword);
  console.log("PASS blank password retention");
  await field("Servidor SMTP").fill("other.example.test");
  await submit("Guardar configuración");
  console.log("Invalid-save feedback:", await page.locator(".feedback").allTextContents());
  await page.screenshot({ path: "output/playwright/mail-settings/validation.png", fullPage: true });
  await page.getByRole("alert").filter({ hasText: "Introduce la contraseña SMTP" }).waitFor();
  assert.equal((await prisma.smtpSettings.findUniqueOrThrow({ where: { id: 1 } })).host, "127.0.0.1");
  await page.reload();
  console.log("PASS invalid host change rejected; sending local SMTP test");
  await submit("Enviar correo de prueba");
  await page.getByText(`El servidor SMTP aceptó el correo de prueba para ${smtpUser}. Revisa la bandeja de entrada y spam.`, { exact: true }).waitFor();
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].recipients, [smtpUser]);
  assert(captured[0].secure, "SMTP authentication must use STARTTLS");
  assert(captured[0].body.includes("Prueba de correo de Valweb"));
  const { sendAccessEmail } = await import("../../src/features/identity/mail");
  await sendAccessEmail("worker-probe@example.test", randomBytes(32).toString("hex"), "INVITE");
  assert.equal(captured.length, 2, "A separate sender process must read the saved settings");
  assert.deepEqual(captured[1].recipients, ["worker-probe@example.test"]);
  assert(captured[1].secure);
  await submit("Enviar correo de prueba");
  await page.getByRole("alert").filter({ hasText: "Espera un minuto" }).waitFor();
  assert.equal(captured.length, 2);
  await mkdir("output/playwright/mail-settings", { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}px`);
    await field("Servidor SMTP").focus();
    assert.notEqual(await field("Servidor SMTP").evaluate(element => getComputedStyle(element).outlineStyle), "none");
    await page.screenshot({ path: `output/playwright/mail-settings/after-${width}.png`, fullPage: true });
  }
  const client = await browser.newPage();
  client.setDefaultTimeout(15000);
  await client.goto(`${base}/login`);
  await client.getByLabel("Correo electrónico", { exact: true }).fill(`smtp-client-${run}@example.test`);
  await client.getByLabel("Contraseña", { exact: true }).fill(password);
  await client.getByRole("button", { name: "Entrar", exact: true }).click();
  await client.waitForURL(`${base}/dashboard`);
  await client.goto(`${base}/admin/ajustes?seccion=notificaciones`);
  assert.equal(await client.getByLabel("Servidor SMTP", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS SMTP settings: encryption, retention, live changes, STARTTLS delivery, rate limit, administrator access and desktop/mobile layout");
} finally {
  await browser?.close();
  await new Promise<void>(resolve => smtp.close(() => resolve()));
  await prisma.smtpSettings.deleteMany();
  if (original) await prisma.smtpSettings.create({ data: original });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, clientId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, clientId] } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
}
