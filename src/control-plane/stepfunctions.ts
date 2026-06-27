import { SendTaskSuccessCommand, SFNClient } from '@aws-sdk/client-sfn';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';

const sfn = new SFNClient({ region: config.AWS_REGION });

/**
 * Señal frontend → orquestador en modo Step Functions: libera el gate humano
 * (`waitForTaskToken`) cuando el usuario confirma la validación en su móvil.
 */
export async function sendTaskSuccess(taskToken: string, jobId: string): Promise<void> {
  await sfn.send(
    new SendTaskSuccessCommand({ taskToken, output: JSON.stringify({ jobId, confirmed: true }) }),
  );
  logger.info({ jobId }, 'SendTaskSuccess enviado');
}
