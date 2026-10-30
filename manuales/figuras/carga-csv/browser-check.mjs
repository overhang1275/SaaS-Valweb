import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = new URL('../../../output/playwright/anatomy-csv/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const errors = [], external = [];
const file = name => new URL(name, import.meta.url).href;
const shot = name => new URL(`${name}.png`, output).pathname;
try {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await page.goto(file('index.html'));
  await page.locator('#interactive').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#publish').isEnabled(), false);
  await page.locator('#example').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'load');
  assert.notEqual(await page.locator('#load').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  await page.keyboard.press('Enter');
  await page.locator('#mapping').selectOption('folio');
  assert.equal(await page.locator('#process').isEnabled(), false);
  await page.locator('#mapping').selectOption('alfanum');
  assert.equal(await page.locator('#process').isEnabled(), false);
  await page.locator('#map').focus(); await page.keyboard.press('Enter');
  await page.locator('#process').focus(); await page.keyboard.press('Enter');
  assert.match(await page.locator('#state-title').textContent(), /Revisa la base candidata/);
  assert.equal(await page.locator('#published-count').textContent(), '0');
  await page.screenshot({ path: shot('review'), fullPage: true });
  await page.locator('#publish').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#published-count').textContent(), '3');
  assert.match(await page.locator('.published').textContent(), /pendiente de activación/);
  await page.screenshot({ path: shot('published'), fullPage: true });
  await page.locator('#example').selectOption('errors');
  assert.equal(await page.locator('#published-count').textContent(), '3');
  await page.locator('#load').click(); await page.locator('#map').click(); await page.locator('#process').click();
  assert.match(await page.locator('#detail').textContent(), /ABC102 y abc102/);
  assert.equal(await page.locator('#publish').isEnabled(), false);
  await page.screenshot({ path: shot('errors'), fullPage: true });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Desbordamiento a ${width}px`);
    await page.screenshot({ path: shot(`width-${width}`), fullPage: true });
  }
  const transform = await page.locator('[data-sheet]').first().getAttribute('transform');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-sheet]').first().getAttribute('transform'), transform, 'Sin movimiento bajo reduced-motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator('#tour').click();
  await page.locator('.stage').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#tour').getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => document.querySelector('#state-title').textContent === 'Selecciona el mapeo', null, { timeout: 15000 });
  await page.locator('#tour').click();
  assert.equal(await page.locator('#tour').getAttribute('aria-pressed'), 'false');

  // Count frames rather than assuming an unchanged position means the loop stopped.
  await page.evaluate(() => {
    window.frameCount = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(now => { window.frameCount++; callback(now); });
  });
  await page.locator('#tour').click();
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => document.querySelector('.stage').getBoundingClientRect().bottom < 0);
  await page.waitForTimeout(300);
  const frames = await page.evaluate(() => window.frameCount);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.frameCount), frames, 'Pausa de animación fuera de pantalla');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(file('oscuro.html'));
  await page.locator('#interactive').waitFor({ state: 'visible' });
  await page.screenshot({ path: shot('dark'), fullPage: true });

  const detail = await browser.newContext({ reducedMotion: 'reduce', deviceScaleFactor: 4, viewport: { width: 1440, height: 1100 } });
  for (const [theme, name] of [['index.html', 'light'], ['oscuro.html', 'dark']]) {
    const closeup = await detail.newPage();
    await closeup.goto(file(theme));
    await closeup.locator('.stage').screenshot({ path: shot(`detail-4x-${name}`) });
    await closeup.close();
  }
  const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 1000 } });
  const staticPage = await nojs.newPage();
  await staticPage.goto(file('index.html'));
  assert.equal(await staticPage.locator('#interactive').isVisible(), false);
  assert.equal(await staticPage.locator('.explanation').isVisible(), true);
  assert.equal(await staticPage.locator('noscript').isVisible(), true);
  assert(await staticPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('CSV: estados, errores, teclado, foco, 4 anchos, movimiento reducido, recorrido, pausa fuera de pantalla, temas y sin JavaScript: OK. Sin red externa ni errores de consola.');
} finally { await browser.close(); }
