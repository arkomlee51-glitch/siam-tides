import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { ENGINE_VERSION } from '@siam/engine';
import { createVerifier } from './auth.js';
import type { Verifier } from './auth.js';
import { loadConfig } from './config.js';
import type { Config } from './config.js';
import { createDb } from './db/index.js';
import type { Db } from './db/index.js';
import { AppError } from './errors.js';
import { GameService } from './game/service.js';
import { LobbyService } from './game/lobby.js';
import { createStore } from './store/index.js';
import type { Store } from './store/index.js';
import { registerGameRoutes } from './routes/games.js';
import { registerLobbyRoutes } from './routes/lobbies.js';
import { registerWsRoutes } from './routes/ws.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    store: Store;
    db: Db;
    auth: Verifier;
    games: GameService;
    lobbies: LobbyService;
  }
}

export interface BuildOptions {
  /** ทับค่า config บางตัว (ใช้ใน test) */
  config?: Partial<Config>;
  /** ใส่ store ของตัวเองเพื่อไม่ให้ app ปิดมันตอน close */
  store?: Store;
  /** ใส่ db ของตัวเอง (เช่น MemoryDb ใน test) เพื่อไม่ให้ app ปิดมันตอน close */
  db?: Db;
  /** ใส่ verifier ของตัวเอง (เช่น ใน test ที่ไม่อยากออกเน็ตไปเช็ค JWKS จริง) */
  auth?: Verifier;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config: Config = { ...loadConfig(), ...opts.config };
  const store = opts.store ?? createStore(config);
  const ownsStore = !opts.store;
  const db = opts.db ?? createDb(config);
  const ownsDb = !opts.db;
  const auth = opts.auth ?? createVerifier(config);

  const app = Fastify({
    logger: opts.logger ?? (config.logLevel !== 'silent' && { level: config.logLevel }),
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);
  app.decorate('store', store);
  app.decorate('db', db);
  app.decorate('auth', auth);
  const games = new GameService(store, db, auth);
  app.decorate('games', games);
  app.decorate('lobbies', new LobbyService(store, games));

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await app.register(websocket, { options: { maxPayload: 1 << 20 } });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send(error.toBody());
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
        details: { issues: error.validation.map((v) => v.params.issue) },
      });
    }
    const err = error as { statusCode?: number; validation?: unknown; message?: string };
    if (err.validation) {
      return reply
        .status(400)
        .send({ error: 'BAD_REQUEST', message: err.message ?? 'ข้อมูลที่ส่งมาไม่ถูกต้อง' });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'unhandled error');
    return reply.status(status).send({
      error: status >= 500 ? 'INTERNAL' : 'BAD_REQUEST',
      message: status >= 500 ? 'เกิดข้อผิดพลาดในระบบ' : (err.message ?? 'คำขอไม่ถูกต้อง'),
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: 'NOT_FOUND', message: `ไม่พบเส้นทาง ${request.method} ${request.url}` }),
  );

  app.get('/health', async () => ({
    ok: true,
    engine: ENGINE_VERSION,
    store: store.kind,
    db: db.kind,
    time: new Date().toISOString(),
  }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await store.ping();
      return { ok: true, store: store.kind };
    } catch (err) {
      app.log.error({ err }, 'store not ready');
      return reply.status(503).send({ error: 'STORE_UNAVAILABLE', message: 'เชื่อมต่อ store ไม่ได้' });
    }
  });

  await app.register(registerGameRoutes);
  await app.register(registerLobbyRoutes);
  await app.register(registerWsRoutes);

  app.addHook('onClose', async () => {
    if (ownsStore) await store.close();
    if (ownsDb) await db.close();
  });

  return app;
}
