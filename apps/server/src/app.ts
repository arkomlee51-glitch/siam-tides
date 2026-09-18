import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { ENGINE_VERSION } from '@siam/engine';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get('/health', async () => ({ ok: true, engine: ENGINE_VERSION, time: new Date().toISOString() }));

  // Phase 3: /games routes, WebSocket, Redis session store
  return app;
}
