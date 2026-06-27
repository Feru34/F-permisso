import { describe, expect, it } from 'vitest';
import { isValidPdf } from '../src/shared/s3.js';

describe('isValidPdf', () => {
  it('acepta un buffer con cabecera %PDF- y tamaño suficiente', () => {
    const buf = Buffer.from('%PDF-1.4\n' + 'x'.repeat(2000), 'latin1');
    expect(isValidPdf(buf)).toBe(true);
  });

  it('rechaza un buffer sin cabecera PDF', () => {
    const buf = Buffer.from('<html>403 Forbidden</html>' + 'x'.repeat(2000), 'latin1');
    expect(isValidPdf(buf)).toBe(false);
  });

  it('rechaza un PDF por debajo del tamaño mínimo', () => {
    const buf = Buffer.from('%PDF-1.4', 'latin1');
    expect(isValidPdf(buf)).toBe(false);
  });
});
