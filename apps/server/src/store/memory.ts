import { lockTimeout } from '../errors.js';
import type { GameRecord, GameUpdate, RateLimitResult, Store, StoreOptions } from './types.js';

interface Expiring<T> {
  value: T;
  expiresAt: number;
}

/**
 * Store ในหน่วยความจำสำหรับ test และการพัฒนาที่ไม่ได้รัน Redis
 * พฤติกรรมที่เห็นจากข้างนอกต้องเหมือน redis.ts ทุกอย่าง (รวมถึง clone ตอนอ่าน/เขียน)
 */
export function createMemoryStore(opts: StoreOptions): Store {
  const games = new Map<string, Expiring<GameRecord>>();
  const idem = new Map<string, Expiring<unknown>>();
  const limits = new Map<string, Expiring<number>>();
  const chains = new Map<string, Promise<void>>();
  const subs = new Map<string, Set<(u: GameUpdate) => void>>();

  const alive = <T>(map: Map<string, Expiring<T>>, key: string): T | null => {
    const hit = map.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      map.delete(key);
      return null;
    }
    return hit.value;
  };

  return {
    kind: 'memory',

    async getGame(id) {
      const rec = alive(games, id);
      return rec ? structuredClone(rec) : null;
    },

    async putGame(record) {
      games.set(record.id, {
        value: structuredClone(record),
        expiresAt: Date.now() + opts.gameTtlSeconds * 1000,
      });
    },

    async withLock(id, fn) {
      const previous = chains.get(id) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const chain = previous.then(() => held);
      chains.set(id, chain);
      let timer: NodeJS.Timeout | undefined;
      const waited = await Promise.race([
        previous.then(() => true as const),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), opts.lockWaitMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (!waited) {
        release();
        throw lockTimeout();
      }
      try {
        return await fn();
      } finally {
        release();
        void chain.then(() => {
          if (chains.get(id) === chain) chains.delete(id);
        });
      }
    },

    async getIdempotent<T>(gameId: string, key: string): Promise<T | null> {
      const hit = alive(idem, `${gameId}:${key}`);
      return hit === null ? null : (structuredClone(hit) as T);
    },

    async setIdempotent(gameId, key, value) {
      idem.set(`${gameId}:${key}`, {
        value: structuredClone(value),
        expiresAt: Date.now() + opts.idempotencyTtlSeconds * 1000,
      });
    },

    async hitRateLimit(key): Promise<RateLimitResult> {
      const now = Date.now();
      const hit = limits.get(key);
      const windowMs = opts.rateLimitWindowSeconds * 1000;
      if (!hit || hit.expiresAt <= now) {
        limits.set(key, { value: 1, expiresAt: now + windowMs });
        return { allowed: true, remaining: opts.rateLimitMax - 1, resetSeconds: opts.rateLimitWindowSeconds };
      }
      hit.value += 1;
      return {
        allowed: hit.value <= opts.rateLimitMax,
        remaining: Math.max(0, opts.rateLimitMax - hit.value),
        resetSeconds: Math.max(1, Math.ceil((hit.expiresAt - now) / 1000)),
      };
    },

    async publish(gameId, update) {
      const handlers = subs.get(gameId);
      if (!handlers) return;
      const frozen = structuredClone(update);
      for (const handler of [...handlers]) handler(structuredClone(frozen));
    },

    async subscribe(gameId, handler) {
      const handlers = subs.get(gameId) ?? new Set();
      handlers.add(handler);
      subs.set(gameId, handlers);
      return async () => {
        handlers.delete(handler);
        if (!handlers.size) subs.delete(gameId);
      };
    },

    async ping() {
      /* ไม่มีอะไรต้องตรวจ */
    },

    async close() {
      games.clear();
      idem.clear();
      limits.clear();
      subs.clear();
      chains.clear();
    },
  };
}
