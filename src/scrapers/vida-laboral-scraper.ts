import type { Download, FrameLocator, Page } from 'playwright';
import { humanDelay } from '../browser/launch.js';
import type { DocSource, JobParams } from '../shared/types.js';
import { BaseScraper, WafBlockedError } from './base-scraper.js';
import { TGSS } from './selectors/tgss.js';

/**
 * Scraper TGSS — Informe de Vida Laboral (vía Import@ss).
 * Flujo (más corto que AEAT): entrada Vida Laboral → identificación Cl@ve Móvil →
 * scope "para mí" → generación asíncrona del informe → descarga del PDF.
 */
export class VidaLaboralScraper extends BaseScraper {
  readonly source: DocSource = 'TGSS';

  protected get claveIframeSelector(): string {
    return TGSS.identificacion.claveIframe;
  }

  protected async gotoIdentification(page: Page, _params: JobParams): Promise<void> {
    await page.goto(TGSS.vidaLaboralEntry.url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const solicitar = page.getByRole('link', { name: TGSS.vidaLaboralEntry.solicitarButton })
      .or(page.getByRole('button', { name: TGSS.vidaLaboralEntry.solicitarButton }))
      .first();
    await this.clickHuman(page, solicitar);
  }

  protected async selectClaveMovil(page: Page, frame: FrameLocator): Promise<void> {
    const inPage = page.getByText(TGSS.identificacion.claveMovilOption).first();
    if (await inPage.count().catch(() => 0)) {
      await this.clickHuman(page, inPage);
      return;
    }
    await frame.getByText(TGSS.identificacion.claveMovilOption).first().click();
  }

  protected async triggerDownload(page: Page, _params: JobParams): Promise<Download | Buffer> {
    // Scope "para mí" (vs representante), si el portal lo solicita.
    const paraMi = page.getByText(TGSS.scope.paraMiOption).first();
    if (await paraMi.count().catch(() => 0)) {
      await this.clickHuman(page, paraMi);
      await humanDelay();
    }

    const inlinePdf = this.attachInlinePdfInterceptor(page);
    const descargar = page.getByRole('link', { name: TGSS.download.descargarPdfLink })
      .or(page.getByRole('button', { name: TGSS.download.descargarPdfLink }))
      .first();

    // El informe puede generarse de forma asíncrona: esperar a que el enlace
    // de descarga esté disponible (polling implícito vía auto-waiting).
    await descargar.waitFor({ state: 'visible', timeout: 45_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }).catch(() => null),
      this.clickHuman(page, descargar),
    ]);
    if (download) return download;

    await humanDelay(800, 1500);
    const buf = inlinePdf.get();
    if (buf) return buf;

    throw new Error('TGSS: no se obtuvo el PDF (ni download ni respuesta inline)');
  }

  protected async assertNotBlocked(page: Page): Promise<void> {
    const body = (await page.content().catch(() => '')) ?? '';
    if (TGSS.errors.accesoDenegado.test(body)) throw new WafBlockedError('TGSS: acceso denegado / 403');
  }
}
