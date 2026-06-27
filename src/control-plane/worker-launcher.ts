import { spawn } from 'node:child_process';
import {
  ECSClient,
  LaunchType,
  RunTaskCommand,
} from '@aws-sdk/client-ecs';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { JobParams } from '../shared/types.js';
import { runJob } from '../worker/run-job.js';

/**
 * Lanza un worker efímero para un job. En producción → ECS Fargate RunTask (una
 * task por sesión Cl@ve). En local → spawn de proceso tsx. En demo → inline.
 */
export async function launchWorker(params: JobParams): Promise<void> {
  if (config.WORKER_LAUNCH_MODE === 'ecs') return launchEcsTask(params);
  if (config.WORKER_LAUNCH_MODE === 'inline') return launchInline(params);
  return launchLocalProcess(params);
}

/** Ejecuta el job en el mismo proceso del API (demo offline; comparte store). */
function launchInline(params: JobParams): void {
  void runJob(params).catch((err) =>
    logger.error({ jobId: params.jobId, err: (err as Error).message }, 'runJob inline falló'),
  );
  logger.info({ jobId: params.jobId }, 'Worker inline lanzado');
}

function launchLocalProcess(params: JobParams): void {
  const child = spawn('npx', ['tsx', 'src/worker/index.ts'], {
    env: { ...process.env, JOB_PARAMS: JSON.stringify(params) },
    stdio: 'inherit',
    shell: process.platform === 'win32',
    detached: false,
  });
  child.on('error', (err) => logger.error({ jobId: params.jobId, err: err.message }, 'spawn worker falló'));
  logger.info({ jobId: params.jobId }, 'Worker local lanzado');
}

async function launchEcsTask(params: JobParams): Promise<void> {
  const ecs = new ECSClient({ region: config.AWS_REGION });
  const subnets = (config.ECS_SUBNETS ?? '').split(',').filter(Boolean);
  const securityGroups = (config.ECS_SECURITY_GROUPS ?? '').split(',').filter(Boolean);

  await ecs.send(
    new RunTaskCommand({
      cluster: config.ECS_CLUSTER,
      taskDefinition: config.ECS_TASK_DEFINITION,
      launchType: LaunchType.FARGATE,
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups,
          assignPublicIp: 'DISABLED', // subred privada + NAT → proxy residencial
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: config.ECS_CONTAINER_NAME,
            environment: [{ name: 'JOB_PARAMS', value: JSON.stringify(params) }],
          },
        ],
      },
    }),
  );
  logger.info({ jobId: params.jobId }, 'ECS RunTask enviado');
}
