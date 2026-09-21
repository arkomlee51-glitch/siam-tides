import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { armyOf, idemKey, makeApp, startGame, submit } from './helpers.js';

let app: FastifyInstance | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await app?.close();
  app = undefined;
});

interface Frame {
  type: string;
  [key: string]: unknown;
}

async function connect(
  instance: FastifyInstance,
  url: string,
): Promise<{ socket: WebSocket; frames: Frame[] }> {
  const frames: Frame[] = [];
  const socket = (await instance.injectWS(url, undefined, {
    onInit: (ws) => {
      ws.on('message', (raw: unknown) => {
        try {
          frames.push(JSON.parse(String(raw)) as Frame);
        } catch {
          /* ไม่ใช่ JSON ก็ข้าม */
        }
      });
    },
  })) as unknown as WebSocket;
  sockets.push(socket);
  return { socket, frames };
}

async function waitFor<T>(get: () => T | undefined, label: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = get();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`รอ ${label} นานเกินไป`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('GET /games/:id/ws', () => {
  it('ปฏิเสธการต่อที่ไม่มี token', async () => {
    app = await makeApp();
    const game = await startGame(app, 'user-1');
    const { frames } = await connect(app, `/games/${game.gameId}/ws`);
    const frame = await waitFor(() => frames.find((f) => f.type === 'error'), 'error frame');
    expect(frame.error).toBe('UNAUTHORIZED');
  });

  it('ส่ง sync ตอนต่อ แล้ว push update เมื่อมีคำสั่งถูกใช้', async () => {
    app = await makeApp();
    const game = await startGame(app, 'user-1', { seed: 99 });
    const { frames } = await connect(app, `/games/${game.gameId}/ws?token=user-1`);

    const sync = await waitFor(() => frames.find((f) => f.type === 'sync'), 'sync frame');
    expect(sync).toMatchObject({ version: 0, factionId: 'p1' });

    const army = armyOf(game.view, 'p1');
    const res = await submit(app, game, 'user-1', {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('ws'),
    });
    expect(res.statusCode).toBe(200);

    const update = await waitFor(() => frames.find((f) => f.type === 'update'), 'update frame');
    expect(update).toMatchObject({ version: 1, seq: 1, factionId: 'p1' });
    const view = update.view as { rng: number; armies: { id: string; mp: number }[] };
    expect(view.rng).toBe(0);
    expect(view.armies.find((a) => a.id === army.id)?.mp).toBe(0);
  });

  it('ตอบ pong ให้ ping และ resync ให้สถานะล่าสุด', async () => {
    app = await makeApp();
    const game = await startGame(app, 'user-1');
    const { socket, frames } = await connect(app, `/games/${game.gameId}/ws?token=user-1`);
    await waitFor(() => frames.find((f) => f.type === 'sync'), 'sync frame');

    socket.send(JSON.stringify({ type: 'ping' }));
    await waitFor(() => frames.find((f) => f.type === 'pong'), 'pong frame');

    const army = armyOf(game.view, 'p1');
    await submit(app, game, 'user-1', {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('resync'),
    });
    socket.send(JSON.stringify({ type: 'resync' }));
    const synced = await waitFor(
      () => frames.filter((f) => f.type === 'sync').find((f) => f.version === 1),
      'sync หลัง resync',
    );
    expect(synced.version).toBe(1);
  });
});
