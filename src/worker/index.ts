import { config } from '../shared/config.js';
import { prisma } from '../shared/prisma.js';
import type { JobParams } from '../shared/types.js';
import { runJob } from './run-job.js';

/** Lee los parámetros del job desde el override de ECS RunTask (JOB_PARAMS). */
function readJobParams(): JobParams {
  if (!config.JOB_PARAMS) throw new Error('Faltan parámetros del job (JOB_PARAMS)');
  const p = JSON.parse(config.JOB_PARAMS) as JobParams;
  if (!p.jobId || !p.userId || !p.docType) throw new Error('JOB_PARAMS incompleto');
  return p;
}

async function main(): Promise<void> {
  const params = readJobParams();
  try {
    await runJob(params);
  } catch {
    process.exitCode = 1; // el detalle ya se registró y publicó dentro de runJob
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Worker crash:', err);
  process.exit(1);
});
