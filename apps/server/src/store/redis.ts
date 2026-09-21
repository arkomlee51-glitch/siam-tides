import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { lockTimeout } from '../errors.js';
import type { GameRecord, GameUpdate, LobbyRecord, RateLimitResult, Store, StoreOptions } from './types.js';

const stateKey = (id: string) => `game:${id}:state`;
const lockKey = (id: string) => `game:${id}:lock`;
const eventsChannel = (id: string) => `game:${id}:events`;
const idemKey = (gameId: string, key: string) => `idem:${gameId}:${key}`;
const rlKey = (key: string) => `rl:${key}`;
const lobbyKey = (code: string) => `lobby:${code}`;
const lobbyLockKey = (code: string) => `lobby:${code}:lock`;

/** ปล่อย lock ได้เฉพาะเจ้าของ token เดิม กัน lock ที่หมดอายุแล้วไปลบของคนอื่น */
const RELEASE = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RedisStoreOptions extends StoreOptions {
  url: string;
}

export function createRedisStore(opts: RedisStoreOptions): Store {
  const client = new Redis(opts.url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  let subscriber: Redis | null = null;
  const handlers = new Map<string, Set<(u: GameUpdate) => void>>();

  async function ensureSubscriber(): Promise<Redis> {
    if (subscriber) return subscriber;
    const sub = client.duplicate();
    sub.on('message', (channel: string, payload: string) => {
      const set = handlers.get(channel);
      if (!set?.size) return;
      let update: GameUpdate;
      try {
        update = JSON.parse(payload) as GameUpdate;
      } catch {
        return;
      }
      for (const handler of [...set]) handler(update);
    });
    subscriber = sub;
    return sub;
  }

  /** ใช้ร่วมกันระหว่าง withLock/withLobbyLock — ต่างกันแค่ key */
  async function withRedisLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const deadline = Date.now() + opts.lockWaitMs;
    let held = false;
    while (!held) {
      const res = await client.set(key, token, 'PX', opts.lockTtlMs, 'NX');
      held = res === 'OK';
      if (held) break;
      if (Date.now() >= deadline) throw lockTimeout();
      await sleep(25);
    }
    try {
      return await fn();
    } finally {
      await client.eval(RELEASE, 1, key, token);
    }
  }

  return {
    kind: 'redis',

    async getGame(id) {
      const raw = await client.get(stateKey(id));
      if (!raw) return null;
      const rec = JSON.parse(raw) as GameRecord;
      // ต่ออายุเกมที่ยังมีคนเล่น
      await client.expire(stateKey(id), opts.gameTtlSeconds);
      return rec;
    },

    async putGame(record) {
      await client.set(stateKey(record.id), JSON.stringify(record), 'EX', opts.gameTtlSeconds);
    },

    async withLock(id, fn) {
      return withRedisLock(lockKey(id), fn);
    },

    async getIdempotent<T>(gameId: string, key: string): Promise<T | null> {
      const raw = await client.get(idemKey(gameId, key));
      return raw === null ? null : (JSON.parse(raw) as T);
    },

    async setIdempotent(gameId, key, value) {
      await client.set(idemKey(gameId, key), JSON.stringify(value), 'EX', opts.idempotencyTtlSeconds);
    },

    async hitRateLimit(key): Promise<RateLimitResult> {
      const k = rlKey(key);
      const res = await client.multi().incr(k).expire(k, opts.rateLimitWindowSeconds, 'NX').ttl(k).exec();
      const count = Number(res?.[0]?.[1] ?? 1);
      const ttl = Number(res?.[2]?.[1] ?? opts.rateLimitWindowSeconds);
      return {
        allowed: count <= opts.rateLimitMax,
        remaining: Math.max(0, opts.rateLimitMax - count),
        resetSeconds: ttl > 0 ? ttl : opts.rateLimitWindowSeconds,
      };
    },

    async publish(gameId, update) {
      await client.publish(eventsChannel(gameId), JSON.stringify(update));
    },

    async subscribe(gameId, handler) {
      const channel = eventsChannel(gameId);
      const sub = await ensureSubscriber();
      const set = handlers.get(channel) ?? new Set();
      const isFirst = set.size === 0;
      set.add(handler);
      handlers.set(channel, set);
      if (isFirst) await sub.subscribe(channel);
      return async () => {
        set.delete(handler);
        if (set.size === 0) {
          handlers.delete(channel);
          if (subscriber) await subscriber.unsubscribe(channel).catch(() => undefined);
        }
      };
    },

    async getLobby(code) {
      const raw = await client.get(lobbyKey(code));
      return raw ? (JSON.parse(raw) as LobbyRecord) : null;
    },

    async putLobby(record) {
      await client.set(lobbyKey(record.code), JSON.stringify(record), 'EX', opts.lobbyTtlSeconds);
    },

    async deleteLobby(code) {
      await client.del(lobbyKey(code));
    },

    async withLobbyLock(code, fn) {
      return withRedisLock(lobbyLockKey(code), fn);
    },

    async ping() {
      await client.ping();
    },

    async close() {
      handlers.clear();
      await Promise.allSettled([subscriber?.quit(), client.quit()]);
      subscriber = null;
    },
  };
}
