import type { Config } from '../config.js';
import { createMemoryStore } from './memory.js';
import { createRedisStore } from './redis.js';
import type { Store, StoreOptions } from './types.js';

export type { GameRecord, GameUpdate, LobbyRecord, LobbySeat, RateLimitResult, SeatRecord, Store, StoreOptions } from './types.js';
export { createMemoryStore } from './memory.js';
export { createRedisStore } from './redis.js';

export function createStore(config: Config): Store {
  const opts: StoreOptions = {
    gameTtlSeconds: config.gameTtlSeconds,
    idempotencyTtlSeconds: config.idempotencyTtlSeconds,
    lockTtlMs: config.lockTtlMs,
    lockWaitMs: config.lockWaitMs,
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowSeconds: config.rateLimitWindowSeconds,
    lobbyTtlSeconds: config.lobbyTtlSeconds,
  };
  return config.store === 'redis'
    ? createRedisStore({ ...opts, url: config.redisUrl })
    : createMemoryStore(opts);
}
