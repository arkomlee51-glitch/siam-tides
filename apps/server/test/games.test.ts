import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { reachableTiles } from '@siam/engine';
import { armyOf, idemKey, makeApp, startGame, submit } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /games', () => {
  it('สร้างเกมและออก token ให้ผู้เล่นทุกที่นั่ง', async () => {
    app = await makeApp();
    const game = await startGame(app, { seed: 7, players: [{ name: 'อาณาจักรนที' }, { name: 'สหายเหนือ' }] });

    expect(game.version).toBe(0);
    expect(game.players.map((p) => p.factionId)).toEqual(['p1', 'p2']);
    expect(game.players.map((p) => p.seat)).toEqual(['center', 'north']);
    expect(new Set(game.players.map((p) => p.token)).size).toBe(2);
    expect(game.view.factions.p1?.name).toBe('อาณาจักรนที');
    expect(game.view.factions.p2?.kind).toBe('human');
  });

  it('ส่ง view ที่ซ่อน rng และคลังของผู้เล่นอื่น', async () => {
    app = await makeApp();
    const game = await startGame(app, { seed: 7, players: [{}, {}] });
    expect(game.view.rng).toBe(0);
    expect(game.view.factions.p2?.res).toEqual({ rice: 0, man: 0, wealth: 0, faith: 0, know: 0 });
    expect(game.view.factions.p1?.res.rice).toBeGreaterThan(0);
  });

  it('ปฏิเสธ body ที่ไม่ถูกต้องด้วย 400 รูปแบบเดียวกัน', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/games', payload: { players: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'BAD_REQUEST' });
    expect(typeof res.json().message).toBe('string');
  });

  it('ปฏิเสธเมื่อเกินโควตา rate limit', async () => {
    app = await makeApp({ rateLimitMax: 2 });
    expect((await app.inject({ method: 'POST', url: '/games', payload: {} })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/games', payload: {} })).statusCode).toBe(201);
    const third = await app.inject({ method: 'POST', url: '/games', payload: {} });
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ error: 'RATE_LIMITED' });
  });
});

describe('GET /games/:id', () => {
  it('ต้องมี token และ token ต้องเป็นของเกมนี้', async () => {
    app = await makeApp();
    const game = await startGame(app);
    const other = await startGame(app);
    const url = `/games/${game.gameId}`;

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${other.players[0]!.token}` },
        })
      ).statusCode,
    ).toBe(403);

    const ok = await app.inject({
      method: 'GET',
      url,
      headers: { 'x-player-token': game.players[0]!.token },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ gameId: game.gameId, version: 0, factionId: 'p1' });
  });

  it('คืน 404 รูปแบบเดียวกันเมื่อไม่มีเกมนั้น', async () => {
    app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/games/00000000-0000-4000-8000-000000000000',
      headers: { authorization: 'Bearer whatever' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});

describe('POST /games/:id/actions', () => {
  it('ใช้คำสั่งแล้ว version เพิ่มขึ้นทีละหนึ่งและส่ง event ที่ผู้เล่นเห็นได้', async () => {
    app = await makeApp();
    const game = await startGame(app);
    const token = game.players[0]!.token;
    const army = armyOf(game.view, 'p1');

    const res = await submit(app, game, token, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('camp'),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ version: 1, seq: 1, factionId: 'p1', replayed: false });
    expect(res.headers['x-idempotent-replay']).toBe('false');
    expect(body.events.some((e: { text: string }) => e.text.includes('ตั้งค่าย'))).toBe(true);
    expect(body.view.armies.find((a: { id: string }) => a.id === army.id).mp).toBe(0);
  });

  it('เดินทัพไปช่องที่ไปถึงได้', async () => {
    app = await makeApp();
    const game = await startGame(app);
    const token = game.players[0]!.token;
    const army = armyOf(game.view, 'p1');
    const dest = [...reachableTiles(game.view, army).values()][0]!;

    const res = await submit(app, game, token, {
      action: { type: 'move', armyId: army.id, c: dest.c, r: dest.r },
      expectedVersion: 0,
      idempotencyKey: idemKey('move'),
    });
    expect(res.statusCode).toBe(200);
    const moved = res.json().view.armies.find((a: { id: string }) => a.id === army.id);
    expect([moved.c, moved.r]).toEqual([dest.c, dest.r]);
  });

  it('ปฏิเสธคำสั่งที่ expectedVersion ล้าสมัยด้วย 409 พร้อม view ล่าสุด', async () => {
    app = await makeApp();
    const game = await startGame(app);
    const token = game.players[0]!.token;
    const army = armyOf(game.view, 'p1');

    await submit(app, game, token, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('first'),
    });
    const stale = await submit(app, game, token, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('stale'),
    });

    expect(stale.statusCode).toBe(409);
    const body = stale.json();
    expect(body.error).toBe('VERSION_CONFLICT');
    expect(body.details.version).toBe(1);
    expect(body.details.view.turn).toBe(1);
  });

  it('ส่ง idempotencyKey ซ้ำได้ผลลัพธ์เดิมและไม่ใช้คำสั่งสองครั้ง', async () => {
    app = await makeApp();
    const game = await startGame(app);
    const token = game.players[0]!.token;
    const army = armyOf(game.view, 'p1');
    const payload = {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('once'),
    };

    const first = await submit(app, game, token, payload);
    const again = await submit(app, game, token, payload);

    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.json().version).toBe(first.json().version);
    expect(again.json().replayed).toBe(true);
    expect(again.headers['x-idempotent-replay']).toBe('true');

    const snapshot = await app.inject({
      method: 'GET',
      url: `/games/${game.gameId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(snapshot.json().version).toBe(1);
  });

  it('คำสั่งที่ engine ปฏิเสธคืน 422 พร้อม error code ของ engine', async () => {
    app = await makeApp();
    const game = await startGame(app);
    const token = game.players[0]!.token;

    const res = await submit(app, game, token, {
      action: { type: 'move', armyId: 'a999', c: 1, r: 1 },
      expectedVersion: 0,
      idempotencyKey: idemKey('bad'),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND', message: 'ไม่พบสิ่งที่ระบุ' });

    const snapshot = await app.inject({
      method: 'GET',
      url: `/games/${game.gameId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(snapshot.json().version).toBe(0);
  });

  it('ปฏิเสธ action ที่ไม่รู้จักตั้งแต่ชั้น schema', async () => {
    app = await makeApp();
    const game = await startGame(app);
    const res = await submit(app, game, game.players[0]!.token, {
      action: { type: 'nuke' },
      expectedVersion: 0,
      idempotencyKey: idemKey('schema'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('BAD_REQUEST');
  });

  it('จำกัดจำนวนคำสั่งต่อผู้เล่นต่อเกม', async () => {
    app = await makeApp({ rateLimitMax: 1 });
    const game = await startGame(app);
    const token = game.players[0]!.token;
    const army = armyOf(game.view, 'p1');
    const first = await submit(app, game, token, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('rl'),
    });
    const second = await submit(app, game, token, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 1,
      idempotencyKey: idemKey('rl'),
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'RATE_LIMITED' });
  });
});

describe('เส้นทางที่ไม่มีอยู่', () => {
  it('คืน error รูปแบบเดียวกัน', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});
