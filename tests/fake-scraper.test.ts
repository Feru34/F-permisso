import { describe, expect, it } from 'vitest';
import { FakeScraper } from '../src/scrapers/fake-scraper.js';
import { HumanGateTimeoutError, type ScraperHooks } from '../src/scrapers/base-scraper.js';
import { isValidPdf } from '../src/shared/s3.js';
import type { ClaveChallenge, JobParams } from '../src/shared/types.js';

const params: JobParams = { jobId: 'jobX', userId: 'u1', docType: 'VIDA_LABORAL' };

function makeHooks(overrides: Partial<ScraperHooks> = {}): {
  hooks: ScraperHooks;
  published: ClaveChallenge[];
} {
  const published: ClaveChallenge[] = [];
  const hooks: ScraperHooks = {
    logger: { info() {}, error() {}, warn() {} } as never,
    gateTimeoutMs: 1200,
    async onChallenge(c) {
      published.push(c);
    },
    async onStatus() {},
    async shouldCancel() {
      return false;
    },
    async isConfirmed() {
      return false;
    },
    ...overrides,
  };
  return { hooks, published };
}

describe('FakeScraper', () => {
  it('publica el reto y devuelve un PDF válido tras la confirmación', async () => {
    const { hooks, published } = makeHooks({ async isConfirmed() { return true; } });
    const result = await new FakeScraper('TGSS').run(undefined as never, params, hooks);

    expect(published[0]?.code).toBe('ABC');
    expect(result.source).toBe('TGSS');
    expect(isValidPdf(result.pdfBuffer)).toBe(true);
  });

  it('lanza HumanGateTimeoutError si no se confirma a tiempo', async () => {
    const { hooks } = makeHooks(); // isConfirmed siempre false
    await expect(new FakeScraper('AEAT').run(undefined as never, params, hooks)).rejects.toBeInstanceOf(
      HumanGateTimeoutError,
    );
  });

  it('lanza si el usuario cancela', async () => {
    const { hooks } = makeHooks({ async shouldCancel() { return true; } });
    await expect(new FakeScraper('AEAT').run(undefined as never, params, hooks)).rejects.toThrow(/cancelado/i);
  });
});
