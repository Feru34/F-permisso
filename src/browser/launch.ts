import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext } from 'playwright';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';

chromium.use(StealthPlugin());

const CHROMIUM_ARGS = [
  '--disable-dev-shm-usage', // OBLIGATORIO en Fargate (/dev/shm de 64MB)
  '--no-sandbox',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--lang=es-ES',
];

export async function launchBrowser(): Promise<Browser> {
  logger.info({ headless: config.HEADLESS }, 'Lanzando Chromium');
  return chromium.launch({
    headless: config.HEADLESS,
    args: CHROMIUM_ARGS,
  }) as unknown as Promise<Browser>;
}

/**
 * Construye el username del proxy con sticky session por job: la sesión Cl@ve
 * debe completarse desde la MISMA IP residencial española.
 */
function buildProxyUsername(jobId: string): string {
  return config.PROXY_USERNAME_TEMPLATE
    .replace('{user}', config.PROXY_USERNAME ?? '')
    .replace('{country}', config.PROXY_COUNTRY)
    .replace('{session}', jobId);
}

/**
 * Crea un contexto efímero con fingerprint coherente ES (locale/timezone/geo/UA)
 * y el proxy residencial fijado por sesión. Un contexto por titular; se destruye
 * al finalizar (privacidad + evasión).
 */
export async function newEsContext(browser: Browser, jobId: string): Promise<BrowserContext> {
  const proxy = config.PROXY_SERVER
    ? {
        server: config.PROXY_SERVER,
        username: buildProxyUsername(jobId),
        password: config.PROXY_PASSWORD,
      }
    : undefined;

  const context = await browser.newContext({
    acceptDownloads: true,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    geolocation: { latitude: 40.4168, longitude: -3.7038 }, // Madrid
    permissions: ['geolocation'],
    userAgent: config.BROWSER_USER_AGENT,
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    extraHTTPHeaders: { 'Accept-Language': 'es-ES,es;q=0.9' },
    proxy,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return context;
}

/**
 * Verifica que la IP de salida real es de España. Aborta el job si no lo es,
 * para evitar disparar el WAF de las sedes.
 */
export async function assertSpanishEgress(context: BrowserContext): Promise<void> {
  if (!config.PROXY_SERVER) {
    logger.warn('Sin proxy configurado — saltando verificación de egress ES');
    return;
  }
  const page = await context.newPage();
  try {
    const res = await page.request.get('https://ipinfo.io/json', { timeout: 15_000 });
    const data = (await res.json()) as { country?: string; ip?: string };
    if (data.country !== 'ES') {
      throw new Error(`Egress no español (country=${data.country}). Abortando.`);
    }
    logger.info({ country: data.country }, 'Egress verificado: España');
  } finally {
    await page.close();
  }
}

/** Pausa aleatoria para simular comportamiento humano. */
export function humanDelay(minMs = 200, maxMs = 800): Promise<void> {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, ms));
}
