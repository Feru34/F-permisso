/**
 * Herramienta de captura Cl@ve Móvil (prueba en vivo, semi-automática).
 *
 * Abre un navegador VISIBLE. Un humano navega manualmente hasta la pantalla de
 * "Autenticación por Cl@ve Móvil" (Renta AEAT o Vida Laboral TGSS). El script
 * detecta esa pantalla y extrae del DOM, en tiempo real:
 *   - el código de verificación (3 alfanuméricos, p. ej. "HD3")
 *   - el temporizador de caducidad (p. ej. "4:18")
 *   - el QR (lo guarda como PNG)
 *
 * NO automatiza la navegación (esos selectores aún no están validados): este es
 * el primer hito — demostrar que podemos sacar el QR/código para mostrarlos en
 * nuestra propia página.
 *
 * Uso:
 *   npx playwright install chromium      # una vez
 *   npx tsx src/tools/capture-clave.ts [urlInicial]
 *
 * Por defecto abre la Sede de la AEAT. Pasa otra URL como argumento si procede.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Page } from 'playwright';

chromium.use(StealthPlugin());

const START_URL = process.argv[2] ?? 'https://sede.agenciatributaria.gob.es/';
const OUT_DIR = path.resolve('captures');

// "Código de verificación" suele ser 3 caracteres alfanuméricos (letra/letra/dígito).
const CODE_RE = /Código de verificación\s*[:\n\r]*\s*([A-Z0-9]{3})\b/i;
const TIMER_RE = /(\d{1,2}:\d{2})/;

interface Capture {
  code: string | null;
  timer: string | null;
}

/** Aplica las expresiones sobre el texto visible ya extraído. */
function parseText(text: string): Capture {
  return {
    code: text.match(CODE_RE)?.[1] ?? null,
    timer: text.match(TIMER_RE)?.[1] ?? null,
  };
}

/** Lee el texto del documento principal y, si no hay código, de un iframe Cl@ve. */
async function extract(page: Page): Promise<Capture> {
  const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
  let cap = parseText(bodyText);
  if (!cap.code) {
    const frameBody = page.frameLocator('iframe[src*="clave"]').locator('body');
    const frameText = await frameBody.innerText({ timeout: 1000 }).catch(() => '');
    if (frameText) cap = parseText(frameText);
  }
  return cap;
}

/** Detecta si la pantalla de Cl@ve Móvil ya está presente. */
async function claveScreenVisible(page: Page): Promise<boolean> {
  const byText = page.getByText(/Código de verificación|Autenticación por Cl@ve Móvil/i).first();
  return (await byText.count().catch(() => 0)) > 0;
}

/** Guarda el QR como PNG (intenta el elemento img/canvas; si no, captura la zona). */
async function saveQr(page: Page, stamp: string): Promise<string | null> {
  const candidates = [
    page.locator('img[src*="qr" i]'),
    page.locator('img[alt*="QR" i]'),
    page.locator('canvas'),
    page.locator('img'),
  ];
  for (const loc of candidates) {
    const first = loc.first();
    if ((await first.count().catch(() => 0)) > 0) {
      try {
        const file = path.join(OUT_DIR, `qr-${stamp}.png`);
        await first.screenshot({ path: file });
        return file;
      } catch {
        /* probar siguiente candidato */
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    acceptDownloads: true,
    viewport: { width: 1366, height: 850 },
  });
  const page = await context.newPage();
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

  console.log('\n────────────────────────────────────────────────────────');
  console.log('  Navegador abierto. Navega MANUALMENTE hasta la pantalla');
  console.log('  "Autenticación por Cl@ve Móvil" (con el QR y el código).');
  console.log('  El script la detectará y extraerá los datos solo.');
  console.log('  Ctrl+C para terminar.');
  console.log('────────────────────────────────────────────────────────\n');

  let lastCode: string | null = null;
  let qrSaved = false;

  // Bucle de sondeo: detecta la pantalla y refresca el temporizador en vivo.
  for (;;) {
    await page.waitForTimeout(1500);
    if (!(await claveScreenVisible(page).catch(() => false))) {
      if (lastCode) {
        console.log('⏹  Pantalla Cl@ve ya no visible (validada/caducada).');
        lastCode = null;
        qrSaved = false;
      }
      continue;
    }

    const cap = await extract(page).catch(() => ({ code: null, timer: null }) as Capture);

    if (cap.code && cap.code !== lastCode) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fullShot = path.join(OUT_DIR, `clave-${stamp}.png`);
      await page.screenshot({ path: fullShot, fullPage: true }).catch(() => undefined);
      const qrFile: string | null = qrSaved ? null : await saveQr(page, stamp);
      qrSaved = Boolean(qrFile) || qrSaved;
      await writeFile(
        path.join(OUT_DIR, `clave-${stamp}.json`),
        JSON.stringify({ url: page.url(), ...cap, fullShot, qrFile }, null, 2),
      );

      console.log('\n✅ PANTALLA Cl@ve DETECTADA Y EXTRAÍDA:');
      console.log(`   Código de verificación : ${cap.code}`);
      console.log(`   Tiempo de caducidad    : ${cap.timer ?? '—'}`);
      console.log(`   URL real               : ${page.url()}`);
      console.log(`   Screenshot             : ${fullShot}`);
      if (qrFile) console.log(`   QR (PNG)               : ${qrFile}`);
      console.log('   → En producción esto se publica por WebSocket a tu frontend.\n');
      lastCode = cap.code;
    } else if (cap.code) {
      process.stdout.write(`\r   ⏱  ${cap.code}  caduca en ${cap.timer ?? '—'}    `);
    }
  }
}

main().catch((err) => {
  console.error('Error en la captura:', err);
  process.exit(1);
});
