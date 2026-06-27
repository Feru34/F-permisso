import type { ClaveChallenge, ExtractionStatus, JobState } from '../types.js';

/**
 * Almacén de estado vivo del job. Fuente de verdad realtime para el handshake
 * human-in-the-loop (señal frontend ↔ worker) y el enrutamiento del WebSocket.
 *
 * La fuente de verdad histórica/legal sigue siendo PostgreSQL (Prisma); este
 * store es efímero y se autolimpia por TTL.
 */
export interface JobStateStore {
  create(jobId: string, initial: Partial<JobState>): Promise<JobState>;
  get(jobId: string): Promise<JobState | undefined>;
  patch(jobId: string, patch: Partial<JobState>): Promise<JobState>;
  setStatus(jobId: string, status: ExtractionStatus): Promise<void>;
  setChallenge(jobId: string, challenge: ClaveChallenge): Promise<void>;
  /** Señal frontend → worker: el usuario validó en su móvil. */
  confirm(jobId: string): Promise<void>;
  /** Solicitud de cancelación desde el frontend. */
  cancel(jobId: string): Promise<void>;
}

function now(): number {
  return Date.now();
}

function ttlSeconds(lifetimeMs: number): number {
  return Math.floor((now() + lifetimeMs) / 1000);
}

/** Implementación en memoria — solo para desarrollo local / tests. */
export class MemoryJobStateStore implements JobStateStore {
  private readonly map = new Map<string, JobState>();

  async create(jobId: string, initial: Partial<JobState>): Promise<JobState> {
    const state: JobState = {
      jobId,
      status: initial.status ?? 'PENDING',
      userConfirmed: false,
      cancelRequested: false,
      updatedAt: now(),
      ttl: ttlSeconds(15 * 60 * 1000),
      ...initial,
    };
    this.map.set(jobId, state);
    return state;
  }

  async get(jobId: string): Promise<JobState | undefined> {
    return this.map.get(jobId);
  }

  async patch(jobId: string, patch: Partial<JobState>): Promise<JobState> {
    const current = this.map.get(jobId);
    if (!current) throw new Error(`JobState ${jobId} no existe`);
    const next: JobState = { ...current, ...patch, updatedAt: now() };
    this.map.set(jobId, next);
    return next;
  }

  async setStatus(jobId: string, status: ExtractionStatus): Promise<void> {
    await this.patch(jobId, { status });
  }

  async setChallenge(jobId: string, challenge: ClaveChallenge): Promise<void> {
    await this.patch(jobId, { challenge, status: 'AWAITING_CLAVE' });
  }

  async confirm(jobId: string): Promise<void> {
    await this.patch(jobId, { userConfirmed: true });
  }

  async cancel(jobId: string): Promise<void> {
    await this.patch(jobId, { cancelRequested: true });
  }
}
