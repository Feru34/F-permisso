import type { Browser, BrowserContext, Download, FrameLocator, Page } from 'playwright';
import type { Logger } from 'pino';
import { assertSpanishEgress, humanDelay, newEsContext } from '../browser/launch.js';
import { isValidPdf } from '../shared/s3.js';
import type {
  ClaveChallenge,
  DocSource,
  JobParams,
  ScrapeResult,
} from '../shared/types.js';

/**
 * Hooks que el worker inyecta para acoplar el scraper al ciclo de vida del job
 * sin que el scraper conozca el transporte (WebSocket / store / Step Functions).
 */
export interface ScraperHooks {
  logger: Logger;
  /** Publica el reto Cl@ve (código 3 letras / QR) al frontend. */
  onChallenge(challenge: ClaveChallenge): Promise<void>;
  /** Notifica cambios de estado relevantes (DOWNLOADING, etc.). */
  onStatus?(status: string): Promise<void>;
  /** Permite abortar si el frontend solicitó cancelación. */
  shouldCancel?(): Promise<boolean>;
  /** Señal explícita frontend → worker (usada por el modo demo / Step Functions). */
  isConfirmed?(): Promise<boolean>;
  /** Ventana de validación Cl@ve en ms (> timer ~1:20 del portal). */
  gateTimeoutMs: number;
}

/** Contrato común de los scrapers (real o demo). */
export interface Scraper {
  readonly source: DocSource;
  run(browser: Browser, params: JobParams, hooks: ScraperHooks): Promise<ScrapeResult>;
}

export class HumanGateTimeoutError extends Error {
  constructor() {
    super('La validación Cl@ve Móvil expiró antes de completarse');
    this.name = 'HumanGateTimeoutError';
  }
}

export class WafBlockedError extends Error {
  constructor(msg = 'Bloqueo WAF detectado (posible 403)') {
    super(msg);
    this.name = 'WafBlockedError';
  }
}

/**
 * Núcleo común de los scrapers AEAT/TGSS: arranque del navegador, proxy ES,
 * login Cl@ve Móvil, extracción del reto, gate human-in-the-loop e intercept de
 * descarga. Las subclases implementan la navegación específica de cada sede.
 */
export abstract class BaseScraper {
  abstract readonly source: DocSource;

  /** URL/selector base de identificación de la sede. */
  protected abstract get claveIframeSelector(): string;

  /** Navega desde la home hasta la pantalla de identificación Cl@ve. */
  protected abstract gotoIdentification(page: Page, params: JobParams): Promise<void>;

  /** Selecciona el método "Cl@ve Móvil" en el widget de identificación. */
  protected abstract selectClaveMovil(page: Page, frame: FrameLocator): Promise<void>;

  /** Tras validar, navega hasta el documento y dispara su descarga. */
  protected abstract triggerDownload(page: Page, params: JobParams): Promise<Download | Buffer>;

  /** Detecta páginas de error / WAF específicas de la sede. */
  protected abstract assertNotBlocked(page: Page): Promise<void>;

  async run(browser: Browser, params: JobParams, hooks: ScraperHooks): Promise<ScrapeResult> {
    const context = await newEsContext(browser, params.jobId);
    try {
      await assertSpanishEgress(context);
      const page = await context.newPage();

      await this.gotoIdentification(page, params);
      await this.assertNotBlocked(page);

      const frame = page.frameLocator(this.claveIframeSelector);
      await this.selectClaveMovil(page, frame);

      const challenge = await this.extractChallenge(page, frame, hooks.gateTimeoutMs);
      await hooks.onChallenge(challenge);

      await this.awaitClaveValidation(page, hooks);

      await hooks.onStatus?.('DOWNLOADING');
      const result = await this.triggerDownload(page, params);
      const pdfBuffer = await this.normalizeDownload(result);

      if (!isValidPdf(pdfBuffer)) {
        throw new Error('El binario descargado no es un PDF válido');
      }

      return {
        pdfBuffer,
        suggestedFilename: `${params.docType}_${params.jobId}.pdf`,
        source: this.source,
      };
    } finally {
      // Destruir el contexto efímero (privacidad + evasión). Nunca reutilizar.
      await context.close().catch(() => undefined);
    }
  }

  /**
   * Extrae el reto Cl@ve del DOM: código de 3 letras mayúsculas o QR (data URL).
   * El reto vive típicamente dentro del iframe de clave.gob.es.
   */
  protected async extractChallenge(
    page: Page,
    frame: FrameLocator,
    gateTimeoutMs: number,
  ): Promise<ClaveChallenge> {
    const expiresAt = Date.now() + gateTimeoutMs;

    // 1) Código de verificación: 3 caracteres alfanuméricos (p. ej. "HD3")
    const codeLocator = frame.locator('text=/^[A-Z0-9]{3}$/').first();
    if (await codeLocator.count().catch(() => 0)) {
      const code = (await codeLocator.innerText()).trim();
      if (/^[A-Z0-9]{3}$/.test(code)) return { code, expiresAt };
    }

    // 2) QR como canvas/imagen → data URL para reenviar al frontend
    const qrLocator = frame.locator('canvas, img[alt*="QR"], img[src*="qr" i]').first();
    if (await qrLocator.count().catch(() => 0)) {
      const qrDataUrl = await qrLocator.evaluate((el) => {
        const c = el as HTMLCanvasElement;
        if (typeof c.toDataURL === 'function') return c.toDataURL('image/png');
        return (el as HTMLImageElement).src;
      });
      if (qrDataUrl) return { qrDataUrl, expiresAt };
    }

    // 3) Fallback fuera del iframe (la pantalla Cl@ve suele ser top-level, no iframe)
    const pageCode = page.locator('text=/^[A-Z0-9]{3}$/').first();
    if (await pageCode.count().catch(() => 0)) {
      const code = (await pageCode.innerText()).trim();
      if (/^[A-Z0-9]{3}$/.test(code)) return { code, expiresAt };
    }

    throw new Error('No se pudo extraer el reto Cl@ve (código ni QR) del DOM');
  }

  /**
   * Gate human-in-the-loop: bloquea el worker hasta que el portal avance (señal
   * implícita: el usuario validó en su móvil) o se agote el timer / se cancele.
   */
  protected async awaitClaveValidation(page: Page, hooks: ScraperHooks): Promise<void> {
    const deadline = Date.now() + hooks.gateTimeoutMs;

    // Señal primaria: el DOM de la sede avanza a la zona privada / siguiente paso.
    const domAdvance = Promise.race([
      page.waitForURL(/portal|privad|tramit|declaraci|importass/i, { timeout: hooks.gateTimeoutMs }),
      page
        .locator('#zona-privada, [data-zona="privada"], text=/sesi[oó]n iniciada/i')
        .first()
        .waitFor({ state: 'visible', timeout: hooks.gateTimeoutMs }),
    ]).then(() => 'advanced' as const);

    // Vigilancia de cancelación (señal frontend → worker).
    const cancelWatch = (async () => {
      while (Date.now() < deadline) {
        if (await hooks.shouldCancel?.()) return 'cancelled' as const;
        await humanDelay(1000, 1500);
      }
      return 'timeout' as const;
    })();

    const outcome = await Promise.race([domAdvance, cancelWatch]).catch(() => 'timeout' as const);

    if (outcome === 'cancelled') throw new Error('Job cancelado por el usuario');
    if (outcome === 'timeout') throw new HumanGateTimeoutError();

    await this.assertNotBlocked(page);
  }

  /** Normaliza el resultado de descarga (Download de Playwright o Buffer interceptado). */
  protected async normalizeDownload(result: Download | Buffer): Promise<Buffer> {
    if (Buffer.isBuffer(result)) return result;
    const stream = await result.createReadStream();
    if (!stream) throw new Error('No se pudo abrir el stream de descarga');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** Captura un PDF servido inline por `Content-Type: application/pdf`. */
  protected attachInlinePdfInterceptor(page: Page): { get(): Buffer | undefined } {
    let pdfBuffer: Buffer | undefined;
    page.on('response', async (res) => {
      try {
        if (res.headers()['content-type']?.includes('application/pdf')) {
          pdfBuffer = await res.body();
        }
      } catch {
        /* respuesta no legible — ignorar */
      }
    });
    return { get: () => pdfBuffer };
  }

  protected async clickHuman(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await humanDelay();
    await locator.hover().catch(() => undefined);
    await humanDelay(120, 350);
    await locator.click();
  }
}
