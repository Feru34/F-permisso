import { Prisma, PrismaClient } from '@prisma/client';
import type { ExtractionStatus } from './types.js';

// Singleton de Prisma. En workers efímeros mantener el connection_limit acotado
// vía la query string de DATABASE_URL (?connection_limit=5) o RDS Proxy.
export const prisma = new PrismaClient();

interface TransitionInput {
  jobId: string;
  to: ExtractionStatus;
  from?: ExtractionStatus;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/**
 * Transición de estado idempotente: actualiza el job y registra un evento de
 * auditoría en la misma transacción. Las transiciones a COMPLETED no se repiten
 * si el job ya está COMPLETED.
 */
export async function transition({ jobId, to, from, data, meta }: TransitionInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const job = await tx.extractionJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error(`Job ${jobId} no existe`);
    if (job.status === 'COMPLETED' && to !== 'COMPLETED') return; // idempotencia

    await tx.extractionJob.update({
      where: { id: jobId },
      data: { status: to, ...(data ?? {}) } as Prisma.ExtractionJobUpdateInput,
    });

    await tx.extractionEvent.create({
      data: {
        jobId,
        fromStatus: from ?? job.status,
        toStatus: to,
        meta: (meta ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  });
}
