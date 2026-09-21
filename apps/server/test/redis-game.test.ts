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
    const game = await startGame(app, 'user-1', { seed: 2024 });
    const army = armyOf(game.view, 'p1');

    const key = idemKey('redis-camp');
    const first = await submit(app, game, 'user-1', {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: key,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().version).toBe(1);

    const replay = await submit(app, game, 'user-1', {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: key,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ version: 1, replayed: true });

    const stale = await submit(app, game, 'user-1', {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('redis-stale'),
    });
    expect(stale.statusCode).toBe(409);

    const endTurn = await submit(app, game, 'user-1', {
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
    const game = await startGame(writer, 'user-1', { seed: 77 });

    const frames: { type: string; version?: number }[] = [];
    const socket = new WebSocketClient(
      `ws://127.0.0.1:${address.port}/games/${game.gameId}/ws?token=user-1`,
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

    const army = armyOf(game.view, 'p1');
    const res = await submit(writer, game, 'user-1', {
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

  it('ห้องรอ + เกมหลายคนใช้ Redis ข้าม instance ได้จริง (ไม่ใช่แค่เกมเดี่ยว)', async () => {
    // instance คนละตัวจำลอง server คนละเครื่อง/คนละ process ที่แชร์ Redis เดียวกัน
    const hostInstance = await redisApp();
    const joinerInstance = await redisApp();

    const created = await hostInstance.inject({
      method: 'POST',
      url: '/lobbies',
      headers: { authorization: 'Bearer host-1' },
      payload: { seed: 909 },
    });
    expect(created.statusCode).toBe(201);
    const lobby = created.json() as { code: string };

    // เข้าร่วมผ่าน instance คนละตัวกับที่สร้างห้อง — lobby ต้องอ่านเจอเพราะเก็บใน Redis ไม่ใช่ memory ของ instance เดียว
    const joined = await joinerInstance.inject({
      method: 'POST',
      url: `/lobbies/${lobby.code}/join`,
      headers: { authorization: 'Bearer p2-user' },
      payload: {},
    });
    expect(joined.statusCode).toBe(200);

    const started = await hostInstance.inject({
      method: 'POST',
      url: `/lobbies/${lobby.code}/start`,
      headers: { authorization: 'Bearer host-1' },
    });
    expect(started.statusCode).toBe(201);
    const game = started.json() as { gameId: string };

    // p2 อ่านเกมผ่าน instance ที่ไม่ได้เริ่มเกม — ต้องได้ view ของตัวเอง (faction p2) ถูกต้องข้าม instance
    const p2View = await joinerInstance.inject({
      method: 'GET',
      url: `/games/${game.gameId}`,
      headers: { authorization: 'Bearer p2-user' },
    });
    expect(p2View.statusCode).toBe(200);
    expect(p2View.json()).toMatchObject({ factionId: 'p2' });

    // แล้ว pub/sub ของ endTurn ก็ต้องข้าม instance ได้เหมือนเกมเดี่ยว — p2 ต่อ WS เข้า instance ที่เริ่มเกม (host)
    await hostInstance.listen({ port: 0, host: '127.0.0.1' });
    const address = hostInstance.server.address();
    if (!address || typeof address === 'string') throw new Error('ไม่ได้พอร์ตของ server');

    const frames: { type: string; version?: number }[] = [];
    const socket = new WebSocketClient(
      `ws://127.0.0.1:${address.port}/games/${game.gameId}/ws?token=host-1`,
    );
    sockets.push(socket);
    socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as { type: string; version?: number }));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    const syncDeadline = Date.now() + 3000;
    while (!frames.some((f) => f.type === 'sync') && Date.now() < syncDeadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // p2 (บน instance คนละตัว) กด endTurn — host ที่ฟัง WS ต้องได้ update ข้าม instance
    const endTurn = await joinerInstance.inject({
      method: 'POST',
      url: `/games/${game.gameId}/actions`,
      headers: { authorization: 'Bearer p2-user' },
      payload: { action: { type: 'endTurn' }, expectedVersion: 0, idempotencyKey: idemKey('lobby-cross') },
    });
    expect(endTurn.statusCode).toBe(200);

    const deadline = Date.now() + 3000;
    while (!frames.some((f) => f.type === 'update') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(frames.find((f) => f.type === 'update')).toBeDefined();
  });
});
