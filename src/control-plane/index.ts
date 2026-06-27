import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ulid } from 'ulid';
import { z } from 'zod';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { prisma } from '../shared/prisma.js';
import { presignDownload } from '../shared/s3.js';
import { getStateStore } from '../shared/state/index.js';
import type { DocType, ServerEvent } from '../shared/types.js';
import { sendTaskSuccess } from './stepfunctions.js';
import { launchWorker } from './worker-launcher.js';
import { WsHub } from './ws-hub.js';

const store = getStateStore();
const hub = new WsHub(config.WS_PORT);

const app = express();
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_ORIGIN }));
app.use(express.json({ limit: '256kb' }));

const createSchema = z
  .object({
    userId: z.string().min(1),
    docType: z.enum(['IRPF_RENTA', 'VIDA_LABORAL']),
    fiscalYear: z.number().int().min(2000).max(2100).optional(),
  })
  .refine((d) => d.docType !== 'IRPF_RENTA' || d.fiscalYear !== undefined, {
    message: 'fiscalYear es requerido para IRPF_RENTA',
    path: ['fiscalYear'],
  });

const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

/**
 * Crea una extracción. Responde 202 inmediato (nada de HTTP síncrono largo:
 * API Gateway REST corta a 29 s). El cliente se suscribe al WebSocket con el jobId.
 */
app.post(
  '/extractions',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const jobId = ulid();
    const source = body.docType === 'IRPF_RENTA' ? 'AEAT' : 'TGSS';

    await prisma.extractionJob.create({
      data: {
        id: jobId,
        userId: body.userId,
        docType: body.docType as DocType as never,
        source,
        fiscalYear: body.fiscalYear ?? null,
        status: 'PENDING',
      },
    });
    await store.create(jobId, { status: 'PENDING' });
    await launchWorker({ jobId, userId: body.userId, docType: body.docType, fiscalYear: body.fiscalYear });

    res.status(202).json({
      jobId,
      status: 'PENDING',
      wsUrl: `ws://localhost:${config.WS_PORT}?jobId=${jobId}`,
    });
  }),
);

/** Señal frontend → worker: el usuario confirma que validó en su móvil Cl@ve. */
app.post(
  '/jobs/:id/confirm',
  asyncHandler(async (req, res) => {
    const jobId = req.params.id;
    await store.confirm(jobId);
    if (config.HUMAN_GATE_MODE === 'stepfunctions') {
      const state = await store.get(jobId);
      if (state?.taskToken) await sendTaskSuccess(state.taskToken, jobId);
    }
    res.json({ ok: true });
  }),
);

app.post(
  '/jobs/:id/cancel',
  asyncHandler(async (req, res) => {
    await store.cancel(req.params.id);
    res.json({ ok: true });
  }),
);

app.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await prisma.extractionJob.findUnique({ where: { id: req.params.id } });
    if (!job) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const downloadUrl =
      job.status === 'COMPLETED' && job.s3Key ? await presignDownload(job.s3Key) : undefined;
    res.json({ ...job, downloadUrl });
  }),
);

/** Endpoint interno: el worker empuja eventos para reenvío inmediato por WS. */
app.post(
  '/internal/jobs/:id/events',
  asyncHandler(async (req, res) => {
    const auth = req.header('authorization');
    if (auth !== `Bearer ${config.INTERNAL_API_TOKEN}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const event = req.body as ServerEvent;
    hub.publish(event);
    res.json({ ok: true });
  }),
);

// Manejador de errores (incluye errores de validación zod).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'validation', issues: err.flatten() });
    return;
  }
  logger.error({ err: (err as Error).message }, 'Error no controlado en API');
  res.status(500).json({ error: 'internal' });
});

app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT }, 'Control-plane API escuchando');
});
