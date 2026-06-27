import { config } from '../shared/config.js';
import { jobLogger } from '../shared/logger.js';
import { prisma, transition } from '../shared/prisma.js';
import { presignDownload, uploadPdf, type UploadResult } from '../shared/s3.js';
import { getStateStore } from '../shared/state/index.js';
import type { DocType, ExtractionStatus, JobParams } from '../shared/types.js';
import { getScraper, type ScraperHooks } from '../scrapers/index.js';
import { HumanGateTimeoutError, WafBlockedError } from '../scrapers/base-scraper.js';
import { launchBrowser } from '../browser/launch.js';
import { publishEvent } from './event-publisher.js';

function classifyError(err: unknown): { status: ExtractionStatus; code: string; message: string } {
  if (err instanceof HumanGateTimeoutError) {
    return { status: 'EXPIRED', code: 'CLAVE_TIMEOUT', message: err.message };
  }
  if (err instanceof WafBlockedError) {
    return { status: 'BLOCKED_WAF', code: 'WAF_BLOCKED', message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 'FAILED', code: 'SCRAPER_ERROR', message };
}

/**
 * Ejecuta una extracción completa: scraping + Cl@ve + descarga + persistencia.
 * Reutilizable tanto por el entrypoint standalone (Fargate) como por el modo
 * inline del control-plane (demo local). Lanza si el job falla.
 */
export async function runJob(params: JobParams): Promise<void> {
  const log = jobLogger(params.jobId);
  const store = getStateStore();

  await prisma.extractionJob.upsert({
    where: { id: params.jobId },
    create: {
      id: params.jobId,
      userId: params.userId,
      docType: params.docType as DocType,
      source: params.docType === 'IRPF_RENTA' ? 'AEAT' : 'TGSS',
      fiscalYear: params.fiscalYear ?? null,
      status: 'PENDING',
      startedAt: new Date(),
    },
    update: { startedAt: new Date() },
  });
  if (!(await store.get(params.jobId))) {
    await store.create(params.jobId, { status: 'PENDING' });
  }

  // El navegador real solo se lanza fuera del modo demo offline.
  const browser = config.DEV_FAKE_SCRAPE ? null : await launchBrowser();

  const watchdog = setTimeout(() => {
    log.error({ ms: config.JOB_MAX_LIFETIME_MS }, 'Watchdog: vida máxima superada, abortando');
    process.exit(1);
  }, config.JOB_MAX_LIFETIME_MS);
  watchdog.unref();

  const hooks: ScraperHooks = {
    logger: log,
    gateTimeoutMs: config.CLAVE_GATE_TIMEOUT_MS,
    async onChallenge(challenge) {
      await store.setChallenge(params.jobId, challenge);
      await transition({ jobId: params.jobId, to: 'AWAITING_CLAVE' });
      await publishEvent({ type: 'STATUS_CHANGED', jobId: params.jobId, status: 'AWAITING_CLAVE' });
      await publishEvent({ type: 'CODE_READY', jobId: params.jobId, challenge });
      log.info({ hasCode: Boolean(challenge.code), hasQr: Boolean(challenge.qrDataUrl) }, 'Reto Cl@ve publicado');
    },
    async onStatus(status) {
      const s = status as ExtractionStatus;
      await store.setStatus(params.jobId, s);
      await transition({ jobId: params.jobId, to: s });
      await publishEvent({ type: 'STATUS_CHANGED', jobId: params.jobId, status: s });
    },
    async shouldCancel() {
      return Boolean((await store.get(params.jobId))?.cancelRequested);
    },
    async isConfirmed() {
      return Boolean((await store.get(params.jobId))?.userConfirmed);
    },
  };

  try {
    log.info({ docType: params.docType, fake: config.DEV_FAKE_SCRAPE }, 'Iniciando extracción');
    const scraper = getScraper(params.docType);
    // FakeScraper ignora el browser; los reales lo requieren.
    const result = await scraper.run(browser as never, params, hooks);

    const skipS3 = config.DEV_SKIP_S3 || config.DEV_FAKE_SCRAPE;
    const upload: UploadResult = skipS3
      ? {
          bucket: '(dev-skip)',
          key: `extractions/${params.userId}/${params.jobId}/${params.docType}.pdf`,
          sizeBytes: result.pdfBuffer.length,
          checksumSha256: 'dev-skip',
        }
      : await uploadPdf({
          userId: params.userId,
          jobId: params.jobId,
          docType: params.docType,
          source: result.source,
          body: result.pdfBuffer,
        });

    await transition({
      jobId: params.jobId,
      to: 'COMPLETED',
      data: {
        s3Bucket: upload.bucket,
        s3Key: upload.key,
        fileSizeBytes: upload.sizeBytes,
        checksumSha256: upload.checksumSha256,
        completedAt: new Date(),
      },
      meta: { sizeBytes: upload.sizeBytes },
    });
    await store.setStatus(params.jobId, 'COMPLETED');

    const downloadUrl = skipS3 ? undefined : await presignDownload(upload.key).catch(() => undefined);
    await publishEvent({ type: 'COMPLETED', jobId: params.jobId, downloadUrl });
    log.info({ key: upload.key, sizeBytes: upload.sizeBytes }, 'Extracción completada');
  } catch (err) {
    const { status, code, message } = classifyError(err);
    log.error({ code, err: message }, 'Extracción fallida');
    await transition({
      jobId: params.jobId,
      to: status,
      data: { errorCode: code, errorMessage: message, completedAt: new Date() },
    }).catch(() => undefined);
    await store.setStatus(params.jobId, status).catch(() => undefined);
    await publishEvent({ type: 'FAILED', jobId: params.jobId, errorCode: code, errorMessage: message });
    throw err;
  } finally {
    clearTimeout(watchdog);
    await browser?.close().catch(() => undefined);
  }
}
