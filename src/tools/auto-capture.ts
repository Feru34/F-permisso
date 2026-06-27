/**
 * Captura AUTOMÁTICA del reto Cl@ve Móvil (objetivo real del producto).
 *
 * La app abre el portal, navega SOLA hasta la pantalla "Autenticación por Cl@ve
 * Móvil", extrae el código de verificación y guarda el QR en ./downloads con el
 * CÓDIGO como nombre de archivo (p. ej. downloads/HD3.png). El usuario final no
 * entra a la web: solo escanea ese QR con su app Cl@ve.
 *
 * Mientras validamos los selectores de navegación, el script ADEMÁS imprime los
 * enlaces/botones reales de cada pantalla ([LINKS @ ...]) para mapear la ruta y,
 * si no llega solo, pausa para que cliques a mano sin que la demo se caiga.
 *
 * Uso:
 *   npx tsx src/tools/auto-capture.ts [urlInicial]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Locator, Page } from 'playwright';

chromium.use(StealthPlugin());

const ARGS = process.argv.slice(2);
const MANUAL = ARGS.includes('--manual'); // no auto-clica; solo registra la ruta y captura
const START_URL = ARGS.find((a) => !a.startsWith('--')) ?? 'https://sede.agenciatributaria.gob.es/Sede/irpf.html';
const DOWNLOADS = path.resolve('downloads');

const CODE_RE = /Código de verificación\s*[:\n\r]*\s*([A-Z0-9]{3})\b/i;
const TIMER_RE = /(\d{1,2}:\d{2})/;
const CLAVE_SCREEN_RE = /Código de verificación|Autenticación por Cl@ve Móvil/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ruta REAL validada (AEAT Renta), descubierta en pruebas:
 *   irpf.html → "Consulta de declaraciones presentadas" → SelectorAccesos
 *             → "Cl@ve Móvil" → pantalla del QR.
 * (No usar "Servicio tramitación…": fuerza certificado y devuelve 403.)
 * `waitMs` = cuánto espera a que aparezca el elemento (pasos opcionales = corto).
 */
const NAV_STEPS: { name: string; patterns: RegExp[]; waitMs: number }[] = [
  { name: 'Aceptar cookies', patterns: [/aceptar todas|aceptar y continuar|^aceptar$/i], waitMs: 1500 },
  { name: 'Consulta de declaraciones presentadas', patterns: [/consulta de declaraciones presentadas/i], waitMs: 8000 },
  { name: 'Cl@ve Movil', patterns: [/cl@ve\s*m[oó]vil/i, /clave\s*m[oó]vil/i], waitMs: 12000 },
];

/** Registra cada URL visitada (manual o automática) para reconstruir la ruta real. */
function attachNavLogger(context: BrowserContext): void {
  let last = '';
  const watch = (p: Page, tag: string) => {
    p.on('framenavigated', (frame) => {
      if (frame !== p.mainFrame()) return;
      const url = p.url();
      if (url && url !== last && !url.startsWith('about:')) {
        last = url;
        console.log(`   [NAV] ${url}`);
      }
    });
  };
  context.on('page', (p) => {
    console.log('   [NUEVA PESTAÑA]');
    watch(p, 'tab');
  });
  for (const p of context.pages()) watch(p, 'main');
}

/** Captura CUALQUIER descarga (PDF) que ocurra en cualquier pestaña → downloads/. */
function attachDownloadCapture(context: BrowserContext): void {
  const handle = (p: Page) => {
    p.on('download', async (d) => {
      const name = d.suggestedFilename() || `descarga-${Date.now()}.pdf`;
      const dest = path.join(DOWNLOADS, name);
      try {
        await d.saveAs(dest);
        console.log(`\n[DESCARGA] Guardado: ${dest}`);
      } catch (e) {
        console.log(`\n[DESCARGA] Fallo al guardar: ${(e as Error).message}`);
      }
    });
  };
  context.on('page', handle);
  for (const p of context.pages()) handle(p);
}

/** Captura cualquier PDF servido inline (content-type application/pdf) en cualquier pestaña. */
function attachPdfCapture(context: BrowserContext): void {
  const seen = new Set<string>();
  const handle = (p: Page) => {
    p.on('response', async (res) => {
      try {
        const ct = res.headers()['content-type'] ?? '';
        if (!ct.includes('application/pdf')) return;
        const url = res.url();
        if (seen.has(url)) return;
        seen.add(url);
        const body = await res.body();
        if (body.length < 100 || body.subarray(0, 5).toString('latin1') !== '%PDF-') return;
        const dest = path.join(DOWNLOADS, `justificante-${Date.now()}.pdf`);
        await writeFile(dest, body);
        console.log(`\n[PDF] Guardado (${body.length} bytes): ${dest}`);
      } catch {
        /* respuesta no legible */
      }
    });
  };
  context.on('page', handle);
  for (const p of context.pages()) handle(p);
}

/** Vuelca la estructura del formulario ZK (inputs/combos/botones/tabla) para fijar selectores. */
async function dumpFormDom(page: Page): Promise<void> {
  const data = await page
    .evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, select, textarea')).map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: (el as HTMLElement).id || null,
        name: (el as HTMLInputElement).name || null,
        cls: (el as HTMLElement).className || null,
        value: (el as HTMLInputElement).value ?? null,
      }));
      const buttons = Array.from(document.querySelectorAll('button, a.z-button, input[type="button"], input[type="submit"], [role="button"]'))
        .map((el) => ((el as HTMLElement).innerText || (el as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && t.length < 40);
      const table = document.querySelector('table, .z-grid, .z-listbox');
      const tableText = table ? (table as HTMLElement).innerText.replace(/\n/g, ' | ').slice(0, 2500) : null;
      return { inputs, buttons: Array.from(new Set(buttons)), tableText };
    })
    .catch(() => null);
  if (!data) {
    console.log('  (no pude volcar el DOM del formulario)');
    return;
  }
  await writeFile(path.join(DOWNLOADS, 'zona-privada-dom.json'), JSON.stringify(data, null, 2));
  console.log('  [DOM] guardado en downloads/zona-privada-dom.json');
  console.log(`        inputs=${data.inputs.length}  botones: ${data.buttons.join(' | ')}`);
}

/** Fija el Ejercicio en el combobox ZK (probando escritura y selección de opción). */
async function setEjercicio(page: Page, year: string): Promise<void> {
  const input = page.locator('xpath=(//*[contains(normalize-space(.),"Ejercicio")]/following::input)[1]').first();
  if ((await input.count().catch(() => 0)) === 0) {
    console.log('  [--] No localice el campo Ejercicio');
    return;
  }
  try {
    await input.click({ timeout: 4000 });
    await page.keyboard.press('Control+A').catch(() => undefined);
    await input.type(year, { delay: 60 });
    await sleep(600);
    const item = page
      .locator(`xpath=//*[contains(@class,"comboitem")][normalize-space(text())="${year}"]`)
      .first();
    if ((await item.count().catch(() => 0)) > 0) await item.click({ timeout: 2000 }).catch(() => undefined);
    else await page.keyboard.press('Enter').catch(() => undefined);
    await sleep(700);
  } catch {
    /* combobox no editable: el volcado DOM nos dirá cómo atacarlo */
  }
}

/** Pulsa el botón "Buscar" del filtro. */
async function clickBuscar(page: Page): Promise<void> {
  const byRole = page.getByRole('button', { name: /^buscar$/i }).first();
  try {
    if ((await byRole.count().catch(() => 0)) > 0) await byRole.click({ timeout: 8000 });
    else await page.locator('button:has-text("Buscar"), a:has-text("Buscar"), input[value="Buscar"]').first().click({ timeout: 8000 });
  } catch {
    console.log('  [--] No pude pulsar Buscar');
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(2500);
}

/** Localiza la fila de resultados (tiene fecha de presentación y botones "Ver"). */
async function findDataRow(page: Page): Promise<Locator | null> {
  const row = page
    .locator('tr, .z-row, .z-listitem')
    .filter({ hasText: /\d{2}\/\d{2}\/\d{4}/ })
    .filter({ hasText: /ver/i })
    .first();
  return (await row.count().catch(() => 0)) > 0 ? row : null;
}

/** Extrae los datos de la fila + del formulario y los devuelve para el JSON. */
async function parseRow(page: Page, row: Locator, year: string): Promise<Record<string, unknown>> {
  const rowText = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  const form = await page
    .evaluate(() => {
      const vals = Array.from(document.querySelectorAll('input')).map((i) => (i as HTMLInputElement).value).filter(Boolean);
      return {
        nif: vals.find((v) => /^[XYZ]?\d{7,8}[A-Z]$/.test(v)) ?? null,
        nombre: vals.find((v) => /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{4,}$/.test(v) && /\s/.test(v)) ?? null,
        modelo: vals.find((v) => /100/.test(v) && /renta|personas fisicas/i.test(v)) ?? null,
        allValues: vals,
      };
    })
    .catch(() => ({ nif: null, nombre: null, modelo: null, allValues: [] as string[] }));
  return {
    capturadoEn: new Date().toISOString(),
    ejercicio: year,
    nif: form.nif,
    nombre: form.nombre,
    modelo: form.modelo,
    expediente: rowText.match(/\b\d{10,}[A-Z]\b/)?.[0] ?? null,
    periodo: rowText.match(/\b\d[A-Z]\b/)?.[0] ?? null,
    fechaPresentacion: rowText.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/)?.[0] ?? null,
    filaCompleta: rowText,
    valoresFormulario: form.allValues,
  };
}

/** Fallback: descarga los bytes de la pestaña del PDF con las cookies del contexto. */
async function savePdfFromPage(page: Page, filename: string): Promise<void> {
  try {
    const resp = await page.request.get(page.url(), { timeout: 20000 });
    const buf = Buffer.from(await resp.body());
    if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
      const dest = path.join(DOWNLOADS, filename);
      await writeFile(dest, buf);
      console.log(`  [PDF] (fallback) guardado (${buf.length} bytes): ${dest}`);
    }
  } catch {
    /* lo habrá cogido attachPdfCapture vía response */
  }
}

/**
 * Paso final: pulsar "Obtención de Justificante" → "Ver". Abre el PDF en una
 * pestaña nueva (visor inline); lo capturamos por response y por fallback.
 */
async function clickVerJustificante(context: BrowserContext, row: Locator, year: string): Promise<void> {
  const DOC = (process.env.DOC ?? 'justificante').toLowerCase(); // 'justificante' | 'fichero'
  const vers = row.locator('button:has-text("Ver"), a:has-text("Ver"), input[value="Ver"]');
  const n = await vers.count().catch(() => 0);
  if (n === 0) {
    console.log('  [--] No hay botones "Ver" en la fila');
    return;
  }
  // Columnas: [0] Obtención de Justificante, [1] Descarga fichero presentado.
  const idx = DOC === 'fichero' ? Math.min(1, n - 1) : 0;
  console.log(`  >> "Ver" (${DOC}, ${idx + 1}/${n}) -> abre el PDF en pestaña nueva`);
  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 20000 }).catch(() => null),
    vers.nth(idx).click({ timeout: 8000 }).catch((e) => console.log('  click Ver fallo: ' + (e as Error).message)),
  ]);
  if (!popup) {
    console.log('  (no se abrio pestaña nueva; el PDF pudo bajar como descarga directa)');
    return;
  }
  await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
  await sleep(2500);
  console.log(`  PDF abierto en: ${popup.url()}`);
  await savePdfFromPage(popup, `justificante-${year}.pdf`);
}

/**
 * Fase posterior a la validación: zona privada autenticada. Rellena el filtro,
 * busca, guarda la fila en JSON y abre el justificante (PDF) para capturarlo.
 */
async function afterValidation(context: BrowserContext, authPage: Page): Promise<void> {
  console.log(`\n[OK] VALIDADO. Zona privada autenticada: ${authPage.url()}`);
  await authPage.waitForLoadState('domcontentloaded').catch(() => undefined);
  await sleep(2500);
  await dumpFormDom(authPage);

  const years = process.env.EJERCICIO ? [process.env.EJERCICIO] : ['2024', '2023', '2025', '2022', '2021'];
  for (const year of years) {
    console.log(`\n>> Ejercicio ${year}: rellenando filtro y buscando...`);
    await setEjercicio(authPage, year);
    await clickBuscar(authPage);
    const row = await findDataRow(authPage);
    if (!row) {
      console.log(`  [--] Sin resultados para ${year}.`);
      continue;
    }
    const info = await parseRow(authPage, row, year);
    const jsonPath = path.join(DOWNLOADS, `declaracion-${year}.json`);
    await writeFile(jsonPath, JSON.stringify(info, null, 2));
    console.log(`  [OK] Fila guardada en ${jsonPath}`);
    console.log('  ' + JSON.stringify(info));
    await clickVerJustificante(context, row, year);
    console.log('\n>> Navegador abierto 3 min para asegurar la captura del PDF.');
    await sleep(180000);
    return;
  }
  console.log('\n[STOP] Sin declaraciones en los ejercicios probados. Revisa downloads/zona-privada-dom.json');
  await sleep(120000);
}

/** Lista enlaces/botones visibles relevantes para mapear la ruta real. */
async function dumpRelevant(page: Page, label: string): Promise<void> {
  const items = await page
    .evaluate(() => {
      const KEEP =
        /(cl@ve|clave|identific|acceder|entrar|tramit|renta web|borrador|declaraci|certificad|referencia|m[oó]vil|vida laboral|informe|aceptar|cookies)/i;
      const nodes = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]'));
      const out: string[] = [];
      for (const el of nodes) {
        const t = (el.textContent || (el as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 90 && KEEP.test(t)) out.push(t);
      }
      return Array.from(new Set(out)).slice(0, 30);
    })
    .catch(() => [] as string[]);

  console.log(`\n  [LINKS @ ${label}] ${page.url()}`);
  if (items.length === 0) console.log('    (sin candidatos visibles; puede haber iframe, popup o cookies)');
  for (const it of items) console.log(`    - ${it}`);
  console.log('');
}

/** Intenta un paso: sondea hasta `waitMs` a que aparezca el elemento y lo clica. */
async function tryClick(page: Page, name: string, patterns: RegExp[], waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  do {
    for (const re of patterns) {
      const candidates = [
        page.getByRole('link', { name: re }).first(),
        page.getByRole('button', { name: re }).first(),
        page.getByText(re).first(),
      ];
      for (const loc of candidates) {
        if ((await loc.count().catch(() => 0)) === 0) continue;
        try {
          await loc.scrollIntoViewIfNeeded().catch(() => undefined);
          await loc.click({ timeout: 5000 });
          await page.waitForLoadState('domcontentloaded').catch(() => undefined);
          await sleep(1200);
          console.log(`  [OK] ${name}: clic (${re})  ->  ${page.url()}`);
          return true;
        } catch {
          /* probar siguiente candidato */
        }
      }
    }
    await sleep(500);
  } while (Date.now() < deadline);
  console.log(`  [--] ${name}: no encontrado en esta pantalla`);
  return false;
}

/** Busca la pantalla Cl@ve en CUALQUIER pestaña abierta (maneja popups/nuevas tabs). */
async function findClavePage(context: BrowserContext, timeoutMs: number): Promise<Page | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      const hit = await p.getByText(CLAVE_SCREEN_RE).first().count().catch(() => 0);
      if (hit > 0) return p;
    }
    await sleep(1000);
  }
  return null;
}

function parse(text: string): { code: string | null; timer: string | null } {
  return { code: text.match(CODE_RE)?.[1] ?? null, timer: text.match(TIMER_RE)?.[1] ?? null };
}

async function readChallenge(page: Page): Promise<{ code: string | null; timer: string | null }> {
  const body = await page.evaluate(() => document.body?.innerText ?? '');
  let cap = parse(body);
  if (!cap.code) {
    const frameText = await page.frameLocator('iframe[src*="clave"]').locator('body').innerText({ timeout: 1000 }).catch(() => '');
    if (frameText) cap = parse(frameText);
  }
  return cap;
}

/** Guarda el QR como downloads/<code>.png (recorta el elemento img/canvas). */
async function saveQr(page: Page, code: string): Promise<string | null> {
  const candidates = [
    page.locator('img[src*="qr" i]'),
    page.locator('img[alt*="QR" i]'),
    page.locator('canvas'),
    page.locator('img'),
  ];
  for (const loc of candidates) {
    const el = loc.first();
    if ((await el.count().catch(() => 0)) === 0) continue;
    try {
      const file = path.join(DOWNLOADS, `${code}.png`);
      await el.screenshot({ path: file });
      return file;
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

async function main(): Promise<void> {
  await mkdir(DOWNLOADS, { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    acceptDownloads: true,
    viewport: { width: 1366, height: 850 },
  });
  attachNavLogger(context);
  attachDownloadCapture(context);
  attachPdfCapture(context); // captura el justificante (PDF inline en pestaña nueva)
  const page = await context.newPage();

  console.log(`\n>> Abriendo ${START_URL}  ${MANUAL ? '(modo MANUAL)' : ''}`);
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
  await dumpRelevant(page, 'inicio'); // <-- enlaces reales de la primera pantalla

  if (MANUAL) {
    console.log('\n>> MODO MANUAL: navega tu hasta la pantalla del QR (elige Cl@ve, NO certificado).');
    console.log('   Voy registrando cada URL con [NAV] y detecto el QR para guardarlo.\n');
  } else {
    console.log('>> Navegando automaticamente hacia Cl@ve Movil...');
    for (const step of NAV_STEPS) {
      await tryClick(page, step.name, step.patterns, step.waitMs);
    }
  }

  let clavePage = MANUAL ? null : await findClavePage(context, 15000);
  if (!clavePage) {
    if (!MANUAL) {
      console.log('\n[WARN] No llegue solo a la pantalla Cl@ve. Enlaces de la pantalla actual:');
      for (const p of context.pages()) {
        if (!p.isClosed()) await dumpRelevant(p, 'tras-navegacion');
      }
      console.log('  Haz tu el/los clic(s) que falten en el navegador; sigo detectandola (4 min)...');
    }
    clavePage = await findClavePage(context, 240000); // 4 min para navegar a mano
  }

  if (!clavePage) {
    const dbg = path.join(DOWNLOADS, `debug-${Date.now()}.png`);
    await page.screenshot({ path: dbg, fullPage: true }).catch(() => undefined);
    console.log(`\n[ERROR] No se alcanzo la pantalla Cl@ve. Screenshot: ${dbg}`);
    console.log(`        URL final: ${page.url()}`);
    await browser.close();
    process.exit(1);
  }

  console.log(`\n[OK] Pantalla Cl@ve detectada en: ${clavePage.url()}`);

  let saved = false;
  let validated = false;
  for (;;) {
    const { code, timer } = await readChallenge(clavePage).catch(() => ({ code: null, timer: null }));
    if (code) {
      if (!saved) {
        const qrFile = await saveQr(clavePage, code);
        const shot = path.join(DOWNLOADS, `${code}-full.png`);
        await clavePage.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
        await writeFile(path.join(DOWNLOADS, `${code}.json`), JSON.stringify({ code, timer, url: clavePage.url(), qrFile }, null, 2));
        console.log('\n*** RETO EXTRAIDO AUTOMATICAMENTE ***');
        console.log(`   Codigo : ${code}`);
        console.log(`   Caduca : ${timer ?? '-'}`);
        console.log(`   QR     : ${qrFile ?? '(no se localizo el elemento QR)'}`);
        console.log('   -> Escanea ese QR con tu app Cl@ve para validar.\n');
        saved = true;
      } else {
        process.stdout.write(`\r   ${code}  caduca en ${timer ?? '-'}    `);
      }
      await sleep(1500);
      continue;
    }
    // Ya no hay codigo: o se valido (entramos a la zona privada) o caduco.
    if (saved) {
      const url = clavePage.url();
      validated = /index\.zul|CONSUL|wlpl\/SCEJ/i.test(url) && !/ObtenerClaveMovilQR/i.test(url);
      break;
    }
    await sleep(1000);
  }

  if (validated) {
    await afterValidation(context, clavePage); // NO cerramos: vamos a por el PDF
  } else {
    console.log('\n[STOP] El reto caduco sin validarse (o no detecte la zona privada).');
  }

  await browser.close();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
