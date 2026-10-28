import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { hash } from "argon2";
import { chromium, type Page } from "playwright";

assert(process.env.TEST_DATABASE_URL && new URL(process.env.TEST_DATABASE_URL).pathname === "/valweb_test", "Use valweb_test");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { prisma } = await import("../../src/lib/prisma");
const run = randomUUID(), adminId = randomUUID(), clientId = randomUUID();
const tenants = Array.from({ length: 61 }, (_, i) => ({ id: randomUUID(), name: `Cuenta ${run} ${String(i).padStart(2, "0")}`, status: i === 60 ? "SUSPENDED" as const : "ACTIVE" as const }));
const password = randomBytes(24).toString("hex"), base = "http://localhost:3001";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30000);
const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
async function login(target: Page, email: string) {
  await target.goto(`${base}/login`); await target.getByLabel("Correo electrónico", { exact: true }).fill(email); await target.getByLabel("Contraseña", { exact: true }).fill(password);
  await target.getByRole("button", { name: "Entrar", exact: true }).click(); await target.waitForURL(`${base}/dashboard`);
}
async function shots(name: string) {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflow ${width}`);
    await page.screenshot({ path: `output/playwright/identity-${name}-${width}.png`, fullPage: true, style: "nextjs-portal { display: none; }" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
async function expectRows(target: Page, count: number) {
  await target.locator("tbody tr:visible").nth(count - 1).waitFor();
  assert.equal(await target.locator("tbody tr:visible").count(), count);
}
try {
  await mkdir("output/playwright", { recursive: true });
  await prisma.tenant.createMany({ data: tenants });
  const passwordHash = await hash(password);
  await prisma.user.create({ data: { id: adminId, email: `admin-${run}@example.test`, name: "Operador de pruebas", role: "ADMIN", status: "ACTIVE", passwordHash } });
  await prisma.user.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ ...(i === 0 ? { id: clientId } : {}), tenantId: tenants[0].id, email: `member-${i}-${run}@example.test`, name: `Miembro ${run} ${i}`, role: "CLIENT" as const, status: (["ACTIVE", "INVITED", "DISABLED"] as const)[i % 3], passwordHash })) });
  await prisma.user.create({ data: { tenantId: tenants[1].id, email: `foreign-${run}@example.test`, name: `Miembro ${run} ajeno`, role: "CLIENT", status: "ACTIVE", passwordHash } });
  await login(page, `admin-${run}@example.test`);
  await page.goto(`${base}/admin/clientes?q=${encodeURIComponent(`Cuenta ${run}`)}`);
  await expectRows(page, 25);
  assert.equal(await page.locator(".list-pagination:visible").count(), 1);
  assert.equal(await page.getByRole("tabpanel").filter({ visible: true }).count(), 1);
  const first = await page.locator("tbody tr:visible").allTextContents();
  await page.getByRole("link", { name: /Página siguiente/ }).first().click(); await page.waitForURL(url => url.searchParams.get("page") === "2");
  await page.getByText("Página 2 de 3", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("q"), `Cuenta ${run}`);
  await expectRows(page, 25);
  assert((await page.locator("tbody tr:visible").allTextContents()).every(text => !first.includes(text)));
  await shots("clients-list");
  await page.getByRole("tablist").getByRole("tab").first().focus(); await page.keyboard.press("ArrowRight");
  await page.getByRole("tabpanel", { name: "Crear cuenta", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("page"), "2");
  assert.equal(await page.locator("tbody tr:visible").count(), 0);
  await page.getByLabel("Nombre de la cuenta", { exact: true }).fill("Borrador sin enviar");
  await shots("clients-create");
  await page.getByRole("tablist").getByRole("tab").first().click();
  await page.goBack(); await page.getByRole("tabpanel", { name: "Crear cuenta", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Nombre de la cuenta", { exact: true }).inputValue(), "Borrador sin enviar");
  await page.getByRole("tablist").getByRole("tab").first().click();
  await page.getByLabel("Filtrar por estado", { exact: true }).selectOption("SUSPENDED"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("estado") === "SUSPENDED");
  await expectRows(page, 1); assert(!new URL(page.url()).searchParams.has("page"));
  assert.equal(await page.locator(".list-pagination:visible").count(), 1);
  assert.equal(await page.getByRole("link", { name: /Página anterior|Página siguiente/ }).count(), 0);
  assert.equal(await page.locator(".list-page-numbers:visible").count(), 0);
  await page.getByRole("link", { name: "Limpiar filtros", exact: true }).click(); await page.waitForURL(`${base}/admin/clientes`);
  await page.waitForFunction(() => (document.querySelector("#client-search") as HTMLInputElement | null)?.value === "");
  assert.equal(await page.getByLabel("Buscar clientes", { exact: true }).inputValue(), "");
  await page.goto(`${base}/admin/clientes?q=${encodeURIComponent(`Cuenta ${run}`)}&page=999999`); await page.waitForURL(url => url.searchParams.get("page") === "3"); await expectRows(page, 11);
  await page.goto(`${base}/admin/usuarios?q=${encodeURIComponent(`Miembro ${run}`)}`);
  await expectRows(page, 25);
  await shots("users-list");
  await page.locator(".search-filter-options > summary").click();
  await page.getByLabel("Filtrar por rol", { exact: true }).selectOption("CLIENT"); await page.getByLabel("Buscar por cuenta", { exact: true }).fill(tenants[0].name);
  await page.getByLabel("Filtrar por estado", { exact: true }).selectOption("INVITED"); await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.waitForURL(url => url.searchParams.get("estado") === "INVITED"); await expectRows(page, 20);
  await page.getByRole("tab", { name: "Invitar usuario", exact: true }).click();
  const invite = page.getByRole("tabpanel", { name: "Invitar usuario", exact: true }); await invite.waitFor();
  assert.equal(await invite.locator(".search-filters").count(), 0); assert.equal(await invite.locator('input[type="search"]').count(), 0);
  assert.equal(await page.locator("tbody tr:visible").count(), 0);
  assert(await invite.getByLabel("Cuenta", { exact: true }).locator("option").count() > 50);
  await invite.getByLabel("Cuenta", { exact: true }).selectOption({ label: tenants[59].name });
  await invite.getByLabel("Nombre", { exact: true }).fill("Invitación sin enviar"); await invite.getByLabel("Correo electrónico", { exact: true }).fill("draft@example.test");
  await shots("users-invite");
  await page.getByRole("tablist").getByRole("tab").first().click(); await page.getByRole("tab", { name: "Invitar usuario", exact: true }).click();
  assert.equal(await invite.getByLabel("Nombre", { exact: true }).inputValue(), "Invitación sin enviar"); assert.equal(await invite.getByLabel("Cuenta", { exact: true }).inputValue(), tenants[59].id);
  await page.reload(); await invite.waitFor(); assert.equal(await invite.locator(".search-filters").count(), 0);
  await page.getByRole("tablist").getByRole("tab").first().click(); await page.getByRole("link", { name: "Limpiar filtros", exact: true }).click(); await page.waitForURL(`${base}/admin/usuarios`);
  await page.waitForFunction(() => (document.querySelector("#user-search") as HTMLInputElement | null)?.value === "");
  assert.equal(await page.getByLabel("Buscar usuarios", { exact: true }).inputValue(), ""); assert.equal(await page.getByLabel("Filtrar por estado", { exact: true }).inputValue(), "");
  await page.getByLabel("Buscar usuarios", { exact: true }).fill(`NOEXISTE-${run}`); await page.getByRole("button", { name: "Buscar", exact: true }).click(); await page.getByRole("heading", { name: "No encontramos coincidencias", exact: true }).waitFor();
  await page.goto(`${base}/admin/usuarios?estado=INVALID`); await page.getByRole("alert").filter({ hasText: "filtros inválidos" }).waitFor();
  const client = await browser.newPage(); await login(client, `member-0-${run}@example.test`); await client.goto(`${base}/admin/usuarios?q=${encodeURIComponent(`Miembro ${run}`)}&pageSize=50`);
  await expectRows(client, 50); assert.equal(await client.getByRole("tab", { name: "Invitar usuario", exact: true }).count(), 0); assert(!(await client.locator("tbody").innerText()).includes("ajeno"));
  await client.goto(`${base}/admin/usuarios?cuenta=${encodeURIComponent(tenants[1].name)}`); await client.getByRole("heading", { name: "No encontramos coincidencias", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.info("PASS: clientes/usuarios búsqueda y filtros servidor, páginas25/50/última, tabs/teclado/URL/atrás/borradores, invitación sin buscador, 61cuentas disponibles, aislamiento y responsive320–1440");
} catch (cause) { await page.screenshot({ path: "output/playwright/identity-filters-failure.png", fullPage: true }); throw cause; }
finally {
  await browser.close();
  const ids = tenants.map(tenant => tenant.id);
  const users = await prisma.user.findMany({ where: { OR: [{ id: adminId }, { tenantId: { in: ids } }] }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map(user => user.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } }); await prisma.tenant.deleteMany({ where: { id: { in: ids } } }); await prisma.$disconnect();
}
