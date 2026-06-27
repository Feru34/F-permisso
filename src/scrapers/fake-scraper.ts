import type { Browser } from 'playwright';
import type { DocSource, JobParams, ScrapeResult } from '../shared/types.js';
import type { Scraper, ScraperHooks } from './base-scraper.js';
import { HumanGateTimeoutError } from './base-scraper.js';

/**
 * Scraper de demostración OFFLINE: no navega a ninguna sede. Simula el ciclo
 * completo (publica un reto Cl@ve, espera la confirmación del usuario y genera
 * un PDF mínimo válido) para poder ejercitar el flujo end-to-end en local sin
 * proxy, sin credenciales y sin tocar AEAT/TGSS. Solo se activa con DEV_FAKE_SCRAPE.
 */
export class FakeScraper implements Scraper {
  readonly source: DocSource;

  constructor(source: DocSource) {
    this.source = source;
  }

  async run(_browser: Browser, params: JobParams, hooks: ScraperHooks): Promise<ScrapeResult> {
    const expiresAt = Date.now() + hooks.gateTimeoutMs;
    await hooks.onChallenge({ code: 'ABC', expiresAt });

    // Espera la confirmación del usuario (POST /jobs/:id/confirm) o el timeout.
    const deadline = Date.now() + hooks.gateTimeoutMs;
    while (Date.now() < deadline) {
      if (await hooks.shouldCancel?.()) throw new Error('Job cancelado por el usuario');
      if (await hooks.isConfirmed?.()) {
        await hooks.onStatus?.('DOWNLOADING');
        return {
          pdfBuffer: buildDummyPdf(params),
          suggestedFilename: `${params.docType}_${params.jobId}.pdf`,
          source: this.source,
        };
      }
      await new Promise((r) => setTimeout(r, 750));
    }
    throw new HumanGateTimeoutError();
  }
}

/** PDF mínimo válido (cabecera %PDF-) con relleno para superar el tamaño mínimo. */
function buildDummyPdf(params: JobParams): Buffer {
  const header = `%PDF-1.4\n% Demo RPA España — ${params.docType} — job ${params.jobId}\n`;
  const padding = '% '.padEnd(1100, '-') + '\n';
  const trailer = '%%EOF\n';
  return Buffer.from(header + padding + trailer, 'latin1');
}
