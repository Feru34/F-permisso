import { config } from '../config.js';
import { DynamoJobStateStore } from './dynamo-store.js';
import { MemoryJobStateStore, type JobStateStore } from './store.js';

let singleton: JobStateStore | undefined;

/** Devuelve el store de estado según STATE_BACKEND (memory | dynamo). */
export function getStateStore(): JobStateStore {
  if (singleton) return singleton;
  singleton = config.STATE_BACKEND === 'dynamo'
    ? new DynamoJobStateStore()
    : new MemoryJobStateStore();
  return singleton;
}

export type { JobStateStore } from './store.js';
