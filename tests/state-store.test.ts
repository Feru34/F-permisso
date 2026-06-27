import { describe, expect, it } from 'vitest';
import { MemoryJobStateStore } from '../src/shared/state/store.js';
import { getStateStore } from '../src/shared/state/index.js';

describe('MemoryJobStateStore', () => {
  it('crea, lee y parchea estado', async () => {
    const store = new MemoryJobStateStore();
    const created = await store.create('job1', { status: 'PENDING' });
    expect(created.status).toBe('PENDING');
    expect(created.userConfirmed).toBe(false);

    const got = await store.get('job1');
    expect(got?.jobId).toBe('job1');

    const patched = await store.patch('job1', { proxySession: 'sess-1' });
    expect(patched.proxySession).toBe('sess-1');
  });

  it('registra el reto y pasa a AWAITING_CLAVE', async () => {
    const store = new MemoryJobStateStore();
    await store.create('job2', {});
    await store.setChallenge('job2', { code: 'ABC', expiresAt: Date.now() + 1000 });
    const s = await store.get('job2');
    expect(s?.status).toBe('AWAITING_CLAVE');
    expect(s?.challenge?.code).toBe('ABC');
  });

  it('propaga confirmación y cancelación', async () => {
    const store = new MemoryJobStateStore();
    await store.create('job3', {});
    await store.confirm('job3');
    expect((await store.get('job3'))?.userConfirmed).toBe(true);
    await store.cancel('job3');
    expect((await store.get('job3'))?.cancelRequested).toBe(true);
  });

  it('lanza al parchear un job inexistente', async () => {
    const store = new MemoryJobStateStore();
    await expect(store.patch('nope', { status: 'FAILED' })).rejects.toThrow();
  });
});

describe('getStateStore', () => {
  it('devuelve el store en memoria con STATE_BACKEND=memory', () => {
    expect(getStateStore()).toBeInstanceOf(MemoryJobStateStore);
  });
});
