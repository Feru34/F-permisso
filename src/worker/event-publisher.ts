import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { ServerEvent } from '../shared/types.js';

/**
 * Empuja eventos al control-plane (endpoint interno) para reenvío inmediato al
 * frontend por WebSocket. Best-effort: si el control-plane no responde, el store
 * de estado sigue siendo la fuente de verdad y el frontend puede reconciliar.
 */
export async function publishEvent(event: ServerEvent): Promise<void> {
  const url = `${config.CONTROL_PLANE_URL}/internal/jobs/${event.jobId}/events`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.INTERNAL_API_TOKEN}`,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      logger.warn({ jobId: event.jobId, status: res.status }, 'publishEvent: respuesta no OK');
    }
  } catch (err) {
    logger.warn({ jobId: event.jobId, err: (err as Error).message }, 'publishEvent falló (best-effort)');
  }
}
