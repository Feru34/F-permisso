import { config } from '../shared/config.js';
import type { DocType } from '../shared/types.js';
import type { Scraper } from './base-scraper.js';
import { FakeScraper } from './fake-scraper.js';
import { RentaScraper } from './renta-scraper.js';
import { VidaLaboralScraper } from './vida-laboral-scraper.js';

/** Selecciona el scraper especializado según el tipo de documento. */
export function getScraper(docType: DocType): Scraper {
  const source = docType === 'IRPF_RENTA' ? 'AEAT' : 'TGSS';

  // Demo offline: no navega a las sedes (ver DEV_FAKE_SCRAPE).
  if (config.DEV_FAKE_SCRAPE) return new FakeScraper(source);

  switch (docType) {
    case 'IRPF_RENTA':
      return new RentaScraper();
    case 'VIDA_LABORAL':
      return new VidaLaboralScraper();
    default: {
      const _exhaustive: never = docType;
      throw new Error(`docType no soportado: ${_exhaustive as string}`);
    }
  }
}

export { BaseScraper } from './base-scraper.js';
export type { Scraper, ScraperHooks } from './base-scraper.js';
