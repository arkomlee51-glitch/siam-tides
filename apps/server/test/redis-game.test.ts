import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket as WebSocketClient } from 'ws';
import type { WebSocket } from 'ws';
import { armyOf, idemKey, makeApp, startGame, submit } from './helpers.js';

/** ตั้ง TEST_REDIS=1 (และรัน `docker compose up -d`) เพื่อทดสอบกับ Redis จริง */
const enabled = process.env.TEST_REDIS === '1';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const instances: FastifyInstance[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(instances.splice(0).map((app) => app.close()));
});

async function redisApp(): Promise<FastifyInstance> {
  const app = await makeApp({ store: 'redis', redisUrl });
  instances.push(app);
  return app;
}

describe.skipIf(!enabled)('เล่นผ่าน server ที่ใช้ Redis', () => {
  it('เล่นเกมเดี่ยวได้ครบและกันคำสั่งซ้ำ/คำสั่งเก่า', async () => {
    const app = await redisApp();
    const game = await startGame(app, { seed: 2024 });
    const token = game.players[0]!.token;
    const army = armyOf(game.view, 'p1');

    const key = idemKey('redis-camp');
    const first = await submit(app, game, token, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: key,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().version).toBe(1);

    const replay = await submit(app, game, token, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: key,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ version: 1, replayed: true });

    const stale = await submit(app, game, token, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('redis-stale'),
    });
    expect(stale.statusCode).toBe(409);

    const endTurn = await submit(app, game, token, {
      action: { type: 'endTurn' },
      expectedVersion: 1,
      idempotencyKey: idemKey('redis-end'),
    });
    expect(endTurn.statusCode).toBe(200);
    expect(endTurn.json().view.turn).toBe(2);
  });

  it('pub/sub ส่ง update ข้าม instance ของ server', async () => {
    // instance ที่อ่าน ต้อง listen จริง เพราะ injectWS ใช้ได้ทีละ instance ในหนึ่ง process
    const reader = await redisApp();
    await reader.listen({ port: 0, host: '127.0.0.1' });
    const address = reader.server.address();
    if (!address || typeof address === 'string') throw new Error('ไม่ได้พอร์ตของ server');

    const writer = await redisApp();
    const game = await startGame(writer, { seed: 77, players: [{}, {}] });
    const [p1, p2] = game.players;

    const frames: { type: string; version?: number }[] = [];
    const socket = new WebSocketClient(
      `ws://127.0.0.1:${address.port}/games/${game.gameId}/ws?token=${encodeURIComponent(p1!.token)}`,
    );
    sockets.push(socket);
    socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as { type: string; version?: number }));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    // รอ sync ก่อน แปลว่า instance ฝั่งอ่าน subscribe เรียบร้อยแล้ว
    const syncDeadline = Date.now() + 3000;
    while (!frames.some((f) => f.type === 'sync') && Date.now() < syncDeadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const army = armyOf(game.view, 'p2');
    const res = await submit(writer, game, p2!.token, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('cross'),
    });
    expect(res.statusCode).toBe(200);

    const deadline = Date.now() + 3000;
    while (!frames.some((f) => f.type === 'update') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(frames.find((f) => f.type === 'sync')?.version).toBe(0);
    expect(frames.find((f) => f.type === 'update')?.version).toBe(1);
  });
});
