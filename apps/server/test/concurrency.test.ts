import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { armyOf, idemKey, makeApp, startGame, submit } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('lock ต่อเกม', () => {
  it('คำสั่งสองคำสั่งที่อ้าง version เดียวกัน สำเร็จได้แค่หนึ่ง', async () => {
    app = await makeApp();
    const game = await startGame(app);
    const token = game.players[0]!.token;
    const army = armyOf(game.view, 'p1');

    const results = await Promise.all([
      submit(app, game, token, {
        action: { type: 'camp', armyId: army.id },
        expectedVersion: 0,
        idempotencyKey: idemKey('race-a'),
      }),
      submit(app, game, token, {
        action: { type: 'camp', armyId: army.id },
        expectedVersion: 0,
        idempotencyKey: idemKey('race-b'),
      }),
    ]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);

    const snapshot = await app.inject({
      method: 'GET',
      url: `/games/${game.gameId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(snapshot.json().version).toBe(1);
  });

  it('idempotencyKey เดียวกันส่งพร้อมกัน ใช้คำสั่งครั้งเดียว', async () => {
    app = await makeApp();
    const game = await startGame(app);
    const token = game.players[0]!.token;
    const army = armyOf(game.view, 'p1');
    const payload = {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('same'),
    };

    const results = await Promise.all([submit(app, game, token, payload), submit(app, game, token, payload)]);

    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(results.map((r) => r.json().version)).toEqual([1, 1]);
    expect(results.filter((r) => r.json().replayed === true)).toHaveLength(1);
  });
});
