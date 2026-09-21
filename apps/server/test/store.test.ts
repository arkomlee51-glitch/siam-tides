import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createGame } from '@siam/engine';
import { createMemoryStore } from '../src/store/memory.js';
import { createRedisStore } from '../src/store/redis.js';
import type { GameRecord, Store, StoreOptions } from '../src/store/index.js';

const opts: StoreOptions = {
  gameTtlSeconds: 60,
  idempotencyTtlSeconds: 60,
  lockTtlMs: 2000,
  lockWaitMs: 1500,
  rateLimitMax: 3,
  rateLimitWindowSeconds: 60,
  lobbyTtlSeconds: 3600,
};

/** ตั้ง TEST_REDIS=1 (และรัน `docker compose up -d`) เพื่อรัน contract เดียวกันกับ Redis จริง */
const redisEnabled = process.env.TEST_REDIS === '1';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const backends = [
  { name: 'memory', enabled: true, make: () => createMemoryStore(opts) },
  { name: 'redis', enabled: redisEnabled, make: () => createRedisStore({ ...opts, url: redisUrl }) },
];

const record = (): GameRecord => {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    version: 0,
    seq: 0,
    seats: [{ factionId: 'p1', seat: 'center', name: 'อาณาจักรนที', userId: 'user-1' }],
    state: createGame({ seed: 4, humans: [{ id: 'p1' }] }),
    createdAt: now,
    updatedAt: now,
    seasonTimerSeconds: null,
    seasonDeadline: null,
  };
};

for (const backend of backends) {
  describe.skipIf(!backend.enabled)(`store contract: ${backend.name}`, () => {
    const store: Store = backend.make();
    afterAll(async () => {
      await store.close();
    });

    it('เก็บและอ่านเกมกลับมาได้เหมือนเดิม', async () => {
      const rec = record();
      expect(await store.getGame(rec.id)).toBeNull();
      await store.putGame(rec);
      const loaded = await store.getGame(rec.id);
      expect(loaded?.version).toBe(0);
      expect(loaded?.state.turn).toBe(1);
      expect(loaded?.seats[0]?.factionId).toBe('p1');
    });

    it('lock ทำให้งานสองชิ้นไม่ทับกัน', async () => {
      const id = randomUUID();
      const trace: string[] = [];
      await Promise.all([
        store.withLock(id, async () => {
          trace.push('a-in');
          await new Promise((r) => setTimeout(r, 40));
          trace.push('a-out');
        }),
        store.withLock(id, async () => {
          trace.push('b-in');
          await new Promise((r) => setTimeout(r, 10));
          trace.push('b-out');
        }),
      ]);
      expect(trace).toHaveLength(4);
      expect(trace.indexOf('a-out')).toBeLessThan(trace.indexOf('b-in'));
    });

    it('เก็บผลลัพธ์ตาม idempotency key', async () => {
      const id = randomUUID();
      expect(await store.getIdempotent(id, 'k1')).toBeNull();
      await store.setIdempotent(id, 'k1', { ok: true, version: 3 });
      expect(await store.getIdempotent(id, 'k1')).toEqual({ ok: true, version: 3 });
      expect(await store.getIdempotent(id, 'k2')).toBeNull();
    });

    it('นับ rate limit ต่อ key', async () => {
      const key = `test:${randomUUID()}`;
      const hits = [
        await store.hitRateLimit(key),
        await store.hitRateLimit(key),
        await store.hitRateLimit(key),
        await store.hitRateLimit(key),
      ];
      expect(hits.map((h) => h.allowed)).toEqual([true, true, true, false]);
      expect(hits[0]?.remaining).toBe(2);
      expect(hits[3]?.resetSeconds).toBeGreaterThan(0);
    });

    it('กระจาย update ให้ผู้ที่ subscribe และหยุดเมื่อ unsubscribe', async () => {
      const id = randomUUID();
      const seen: number[] = [];
      const unsubscribe = await store.subscribe(id, (u) => seen.push(u.version));
      const rec = record();
      await store.publish(id, { version: 7, seq: 7, state: rec.state, events: [] });
      await new Promise((r) => setTimeout(r, 60));
      expect(seen).toEqual([7]);

      await unsubscribe();
      await store.publish(id, { version: 8, seq: 8, state: rec.state, events: [] });
      await new Promise((r) => setTimeout(r, 60));
      expect(seen).toEqual([7]);
    });

    it('ping สำเร็จ', async () => {
      await expect(store.ping()).resolves.toBeUndefined();
    });
  });
}
