import type { Download, FrameLocator, Page } from 'playwright';
import { humanDelay } from '../browser/launch.js';
import type { DocSource, JobParams } from '../shared/types.js';
import { BaseScraper, WafBlockedError } from './base-scraper.js';
import { AEAT } from './selectors/aeat.js';

/**
 * Scraper AEAT — Declaración de la Renta (IRPF).
 * Flujo: home Renta → identificación Cl@ve Móvil → selección de ejercicio →
 * navegación a la declaración → descarga del PDF.
 */
export class RentaScraper extends BaseScraper {
  readonly source: DocSource = 'AEAT';

  protected get claveIframeSelector(): string {
    return AEAT.identificacion.claveIframe;
  }

  protected async gotoIdentification(page: Page, _params: JobParams): Promise<void> {
    await page.goto(AEAT.rentaEntry.url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const acceder = page.getByRole('link', { name: AEAT.rentaEntry.accederButton })
      .or(page.getByRole('button', { name: AEAT.rentaEntry.accederButton }))
      .first();
    await this.clickHuman(page, acceder);
  }

  protected async selectClaveMovil(page: Page, frame: FrameLocator): Promise<void> {
    // El selector de método puede estar en la página o dentro del iframe Cl@ve.
    const inPage = page.getByText(AEAT.identificacion.claveMovilOption).first();
    if (await inPage.count().catch(() => 0)) {
      await this.clickHuman(page, inPage);
      return;
    }
    const inFrame = frame.getByText(AEAT.identificacion.claveMovilOption).first();
    await inFrame.click();
  }

  protected async triggerDownload(page: Page, params: JobParams): Promise<Download | Buffer> {
    // Selección de ejercicio fiscal (requerido en Renta).
    if (params.fiscalYear) {
      const yearSelect = page.locator(AEAT.ejercicio.selectFiscalYear).first();
      if (await yearSelect.count().catch(() => 0)) {
        await yearSelect.selectOption(String(params.fiscalYear)).catch(() => undefined);
        await humanDelay();
      }
    }

    const inlinePdf = this.attachInlinePdfInterceptor(page);
    const descargar = page.getByRole('button', { name: AEAT.download.descargarPdfButton })
      .or(page.getByRole('link', { name: AEAT.download.descargarPdfButton }))
      .first();

    // Caso 1: descarga directa (evento download).
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }).catch(() => null),
      this.clickHuman(page, descargar),
    ]);
    if (download) return download;

    // Caso 2: PDF servido inline → buffer interceptado.
    await humanDelay(800, 1500);
    const buf = inlinePdf.get();
    if (buf) return buf;

    throw new Error('AEAT: no se obtuvo el PDF (ni download ni respuesta inline)');
  }

  protected async assertNotBlocked(page: Page): Promise<void> {
    const body = (await page.content().catch(() => '')) ?? '';
    if (AEAT.errors.accesoDenegado.test(body)) throw new WafBlockedError('AEAT: acceso denegado / 403');
  }
}
