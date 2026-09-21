import type { FastifyInstance } from 'fastify';
import type { Army, GameState } from '@siam/engine';
import type { AuthContext, Verifier } from '../src/auth.js';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { createMemoryDb } from '../src/db/memory.js';
import type { Db } from '../src/db/index.js';
import { createMemoryStore } from '../src/store/memory.js';
import type { Store } from '../src/store/index.js';

/**
 * verifier จำลองสำหรับ test — "token" คือ userId ตรง ๆ ไม่ต้องออกเน็ตไปเช็ค JWKS จริง
 * (คู่กับของจริงใน src/auth.ts ที่ตรวจ JWT ของ Supabase)
 */
export function createFakeVerifier(): Verifier {
  return {
    verify(token: string): Promise<AuthContext> {
      return Promise.resolve({
        userId: token,
        isAnonymous: false,
        email: `${token}@test.local`,
        claims: { sub: token },
      });
    },
  };
}

export async function makeApp(
  config: Partial<Config> = {},
  opts: { db?: Db; auth?: Verifier; store?: Store } = {},
): Promise<FastifyInstance> {
  return buildApp({
    config: { store: 'memory', logLevel: 'silent', rateLimitMax: 10_000, ...config },
    store: opts.store,
    db: opts.db ?? createMemoryDb(),
    auth: opts.auth ?? createFakeVerifier(),
    logger: false,
  });
}

/** เหมือน makeApp แต่คืน db/store ที่ใช้จริงกลับมาด้วย — ให้ test คุม cold-start replay ได้ตรง ๆ (เช่น เคลียร์ Redis/memory store เอง) */
export async function makeAppWithParts(
  config: Partial<Config> = {},
  opts: { db?: Db; auth?: Verifier } = {},
): Promise<{ app: FastifyInstance; db: Db; store: Store }> {
  const db = opts.db ?? createMemoryDb();
  const store = createMemoryStore({
    gameTtlSeconds: config.gameTtlSeconds ?? 60 * 60 * 24,
    idempotencyTtlSeconds: config.idempotencyTtlSeconds ?? 600,
    lockTtlMs: config.lockTtlMs ?? 2000,
    lockWaitMs: config.lockWaitMs ?? 3000,
    rateLimitMax: config.rateLimitMax ?? 10_000,
    rateLimitWindowSeconds: config.rateLimitWindowSeconds ?? 60,
  });
  const app = await buildApp({
    config: { store: 'memory', logLevel: 'silent', rateLimitMax: 10_000, ...config },
    store,
    db,
    auth: opts.auth ?? createFakeVerifier(),
    logger: false,
  });
  return { app, db, store };
}

export interface StartedGame {
  gameId: string;
  version: number;
  seq: number;
  factionId: string;
  view: GameState;
}

export async function startGame(
  app: FastifyInstance,
  userId: string,
  payload: Record<string, unknown> = { seed: 12345 },
): Promise<StartedGame> {
  const res = await app.inject({
    method: 'POST',
    url: '/games',
    headers: { authorization: `Bearer ${userId}` },
    payload,
  });
  if (res.statusCode !== 201) throw new Error(`สร้างเกมไม่สำเร็จ: ${res.statusCode} ${res.body}`);
  return res.json() as StartedGame;
}

export const armyOf = (view: GameState, factionId: string): Army => {
  const army = view.armies.find((a) => a.owner === factionId);
  if (!army) throw new Error(`ไม่พบทัพของ ${factionId}`);
  return army;
};

let keySeq = 0;
export const idemKey = (label = 'k') => `${label}-${++keySeq}-${'x'.repeat(8)}`;

export function submit(
  app: FastifyInstance,
  game: { gameId: string },
  userId: string,
  body: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/games/${game.gameId}/actions`,
    headers: { authorization: `Bearer ${userId}` },
    payload: body,
  });
}
