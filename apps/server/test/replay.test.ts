import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { armyOf, idemKey, makeAppWithParts, submit } from './helpers.js';
import type { StartedGame } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('cold-start replay (Redis หมดอายุ → โหลดจาก Supabase snapshot + action log)', () => {
  it('GET /games/:id ยังคืน state ที่ถูกต้องได้แม้ store ร้อนลืมเกมนี้ไปแล้ว', async () => {
    // gameTtlSeconds สั้นมาก เพื่อจำลอง Redis หมดอายุ/instance ใหม่โดยไม่ต้องรอจริงนาน ๆ
    const parts = await makeAppWithParts({ gameTtlSeconds: 1 });
    app = parts.app;

    const created = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { authorization: 'Bearer user-1' },
      payload: { seed: 4242 },
    });
    expect(created.statusCode).toBe(201);
    const game = created.json() as StartedGame;
    const army = armyOf(game.view, 'p1');

    // สั่ง camp แล้ว endTurn — ให้มี snapshot ต้นฤดูที่ 2 เก็บลง Db ด้วย (ไม่ใช่แค่ replay จาก genesis)
    const camp = await submit(app, game, 'user-1', {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('replay-camp'),
    });
    expect(camp.statusCode).toBe(200);

    const endTurn = await submit(app, game, 'user-1', {
      action: { type: 'endTurn' },
      expectedVersion: 1,
      idempotencyKey: idemKey('replay-end'),
    });
    expect(endTurn.statusCode).toBe(200);
    const beforeExpiry = endTurn.json();
    expect(beforeExpiry.version).toBe(2);
    expect(beforeExpiry.view.turn).toBe(2);

    // รอให้ TTL ของ store (ร้อน) หมดอายุ — เหลือแค่ Db (ถาวร) เท่านั้นที่ยังมีเกมนี้
    await sleep(1300);
    expect(await parts.store.getGame(game.gameId)).toBeNull();

    const afterExpiry = await app.inject({
      method: 'GET',
      url: `/games/${game.gameId}`,
      headers: { authorization: 'Bearer user-1' },
    });
    expect(afterExpiry.statusCode).toBe(200);
    const snapshot = afterExpiry.json();
    expect(snapshot.version).toBe(2);
    expect(snapshot.view.turn).toBe(2);
    expect(snapshot.view).toEqual(beforeExpiry.view);

    // ยังส่งคำสั่งต่อได้ตามปกติหลัง replay กลับมา — version เดินต่อจากเดิม ไม่ย้อนกลับ
    const armyAfter = armyOf(snapshot.view, 'p1');
    const next = await submit(app, game, 'user-1', {
      action: { type: 'camp', armyId: armyAfter.id },
      expectedVersion: 2,
      idempotencyKey: idemKey('replay-continue'),
    });
    expect(next.statusCode).toBe(200);
    expect(next.json().version).toBe(3);
  });
});
