import pino from 'pino';
import { config } from './config.js';

// Logger con redacción estricta: nunca debe emerger el código Cl@ve, cookies,
// cabeceras de autorización ni contenido del PDF en los logs.
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'code',
      'challenge.code',
      'challenge.qrDataUrl',
      'pdfBuffer',
      'password',
      'proxy.password',
      'PROXY_PASSWORD',
      'headers.cookie',
      'headers.authorization',
      '*.cookie',
      '*.authorization',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'rpa-espana' },
});

export function jobLogger(jobId: string) {
  return logger.child({ jobId });
}
