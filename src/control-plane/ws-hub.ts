import { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../shared/logger.js';
import type { ServerEvent } from '../shared/types.js';

/**
 * Hub de WebSocket: registra sockets por jobId y reenvía eventos del worker al
 * frontend. Mantiene heartbeat (ping/pong) para sobrevivir a proxies intermedios
 * durante la ventana de validación Cl@ve (~1:20).
 */
export class WsHub {
  private readonly wss: WebSocketServer;
  private readonly byJob = new Map<string, Set<WebSocket>>();
  private readonly alive = new WeakMap<WebSocket, boolean>();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    setInterval(() => this.heartbeat(), 30_000).unref();
    logger.info({ port }, 'WebSocket hub escuchando');
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '', 'http://localhost');
    const jobId = url.searchParams.get('jobId');
    if (!jobId) {
      ws.close(1008, 'jobId requerido');
      return;
    }
    const set = this.byJob.get(jobId) ?? new Set();
    set.add(ws);
    this.byJob.set(jobId, set);
    this.alive.set(ws, true);

    ws.on('pong', () => this.alive.set(ws, true));
    ws.on('close', () => {
      set.delete(ws);
      if (set.size === 0) this.byJob.delete(jobId);
    });
    ws.on('error', (err) => logger.warn({ jobId, err: err.message }, 'WS error'));

    logger.info({ jobId }, 'Cliente WS suscrito');
  }

  /** Reenvía un evento a todos los sockets suscritos al job. */
  publish(event: ServerEvent): void {
    const set = this.byJob.get(event.jobId);
    if (!set) return;
    const payload = JSON.stringify(event);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  private heartbeat(): void {
    for (const set of this.byJob.values()) {
      for (const ws of set) {
        if (this.alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        this.alive.set(ws, false);
        ws.ping();
      }
    }
  }
}
