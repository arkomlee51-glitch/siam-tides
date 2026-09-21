import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { idemKey, makeApp } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

interface LobbyBody {
  code: string;
  hostUserId: string;
  seats: { userId: string; name: string }[];
  startedGameId: string | null;
}

async function createLobby(
  instance: FastifyInstance,
  userId: string,
  payload: Record<string, unknown> = {},
) {
  return instance.inject({
    method: 'POST',
    url: '/lobbies',
    headers: { authorization: `Bearer ${userId}` },
    payload,
  });
}

const joinLobby = (instance: FastifyInstance, code: string, userId: string, name?: string) =>
  instance.inject({
    method: 'POST',
    url: `/lobbies/${code}/join`,
    headers: { authorization: `Bearer ${userId}` },
    payload: name ? { name } : {},
  });

const getLobby = (instance: FastifyInstance, code: string, userId: string) =>
  instance.inject({ method: 'GET', url: `/lobbies/${code}`, headers: { authorization: `Bearer ${userId}` } });

const leaveLobby = (instance: FastifyInstance, code: string, userId: string) =>
  instance.inject({
    method: 'POST',
    url: `/lobbies/${code}/leave`,
    headers: { authorization: `Bearer ${userId}` },
  });

const startLobby = (instance: FastifyInstance, code: string, userId: string) =>
  instance.inject({
    method: 'POST',
    url: `/lobbies/${code}/start`,
    headers: { authorization: `Bearer ${userId}` },
  });

describe('POST /lobbies', () => {
  it('สร้างห้องรอ — host ได้ที่นั่งแรกอัตโนมัติ', async () => {
    app = await makeApp();
    const res = await createLobby(app, 'host-1', { name: 'เจ้าของห้อง' });
    expect(res.statusCode).toBe(201);
    const lobby = res.json() as LobbyBody;
    expect(lobby.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(lobby.hostUserId).toBe('host-1');
    expect(lobby.seats).toEqual([{ userId: 'host-1', name: 'เจ้าของห้อง' }]);
    expect(lobby.startedGameId).toBeNull();
  });

  it('ต้องมี token ถึงจะสร้างห้องได้', async () => {
    app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/lobbies', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('เข้าร่วม/ออกจากห้องรอ', () => {
  it('คนที่สองเข้าร่วมด้วยโค้ดได้ที่นั่งถัดไป', async () => {
    app = await makeApp();
    const created = (await createLobby(app, 'host-1')).json() as LobbyBody;

    const joined = await joinLobby(app, created.code, 'p2', 'คนที่สอง');
    expect(joined.statusCode).toBe(200);
    const lobby = joined.json() as LobbyBody;
    expect(lobby.seats.map((s) => s.userId)).toEqual(['host-1', 'p2']);
    expect(lobby.seats[1]?.name).toBe('คนที่สอง');
  });

  it('เข้าร่วมซ้ำด้วย user เดิมไม่เพิ่มที่นั่งใหม่ (idempotent)', async () => {
    app = await makeApp();
    const created = (await createLobby(app, 'host-1')).json() as LobbyBody;
    await joinLobby(app, created.code, 'p2');
    const again = await joinLobby(app, created.code, 'p2', 'ชื่อใหม่');
    expect(again.statusCode).toBe(200);
    const lobby = again.json() as LobbyBody;
    expect(lobby.seats).toHaveLength(2);
    expect(lobby.seats[1]?.name).toBe('ชื่อใหม่');
  });

  it('ห้องเต็ม 4 คนแล้วคนที่ 5 เข้าร่วมไม่ได้', async () => {
    app = await makeApp();
    const created = (await createLobby(app, 'host-1')).json() as LobbyBody;
    await joinLobby(app, created.code, 'p2');
    await joinLobby(app, created.code, 'p3');
    await joinLobby(app, created.code, 'p4');
    const fifth = await joinLobby(app, created.code, 'p5');
    expect(fifth.statusCode).toBe(422);
    expect(fifth.json()).toMatchObject({ error: 'LOBBY_FULL' });
  });

  it('เข้าร่วมห้องที่ไม่มีอยู่จริงได้ 404', async () => {
    app = await makeApp();
    const res = await joinLobby(app, 'ZZZZZZ', 'p2');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'LOBBY_NOT_FOUND' });
  });

  it('สมาชิกออกจากห้อง (ไม่ใช่ host) เอาที่นั่งตัวเองออกเท่านั้น', async () => {
    app = await makeApp();
    const created = (await createLobby(app, 'host-1')).json() as LobbyBody;
    await joinLobby(app, created.code, 'p2');
    const left = await leaveLobby(app, created.code, 'p2');
    expect(left.statusCode).toBe(204);
    const lobby = (await getLobby(app, created.code, 'host-1')).json() as LobbyBody;
    expect(lobby.seats.map((s) => s.userId)).toEqual(['host-1']);
  });

  it('host ออกจากห้อง = ยกเลิกห้องทั้งหมด', async () => {
    app = await makeApp();
    const created = (await createLobby(app, 'host-1')).json() as LobbyBody;
    await joinLobby(app, created.code, 'p2');
    const left = await leaveLobby(app, created.code, 'host-1');
    expect(left.statusCode).toBe(204);
    const after = await getLobby(app, created.code, 'p2');
    expect(after.statusCode).toBe(404);
  });
});

describe('เริ่มเกมจากห้องรอ', () => {
  it('เฉพาะ host เริ่มเกมได้', async () => {
    app = await makeApp();
    const created = (await createLobby(app, 'host-1')).json() as LobbyBody;
    await joinLobby(app, created.code, 'p2');
    const res = await startLobby(app, created.code, 'p2');
    expect(res.statusCode).toBe(403);
  });

  it('host เริ่มเกมแล้วทุกที่นั่งได้ view ของตัวเองจาก GET /games/:id', async () => {
    app = await makeApp();
    const created = (await createLobby(app, 'host-1', { seed: 777 })).json() as LobbyBody;
    await joinLobby(app, created.code, 'p2-user', 'ผู้เล่นสอง');

    const started = await startLobby(app, created.code, 'host-1');
    expect(started.statusCode).toBe(201);
    const hostSnapshot = started.json() as { gameId: string; factionId: string; view: unknown };
    expect(hostSnapshot.factionId).toBe('p1');

    const lobbyAfter = (await getLobby(app, created.code, 'host-1')).json() as LobbyBody;
    expect(lobbyAfter.startedGameId).toBe(hostSnapshot.gameId);

    const secondView = await app.inject({
      method: 'GET',
      url: `/games/${hostSnapshot.gameId}`,
      headers: { authorization: 'Bearer p2-user' },
    });
    expect(secondView.statusCode).toBe(200);
    expect(secondView.json()).toMatchObject({ factionId: 'p2' });
  });

  it('เริ่มเกมไปแล้วเริ่มซ้ำหรือเข้าร่วมอีกไม่ได้ (409 พร้อม gameId)', async () => {
    app = await makeApp();
    const created = (await createLobby(app, 'host-1')).json() as LobbyBody;
    await startLobby(app, created.code, 'host-1');

    const startAgain = await startLobby(app, created.code, 'host-1');
    expect(startAgain.statusCode).toBe(409);
    expect(startAgain.json()).toMatchObject({ error: 'LOBBY_STARTED' });

    const joinAfter = await joinLobby(app, created.code, 'late-comer');
    expect(joinAfter.statusCode).toBe(409);
  });

  it('เกมหลายคนคำนวณฤดูก็ต่อเมื่อมนุษย์ทุกคน endTurn (ไม่ใช่แค่คนแรก)', async () => {
    app = await makeApp();
    const created = (await createLobby(app, 'host-1', { seed: 42 })).json() as LobbyBody;
    await joinLobby(app, created.code, 'p2-user');
    const started = (await startLobby(app, created.code, 'host-1')).json() as {
      gameId: string;
      version: number;
      view: import('@siam/engine').GameState;
    };

    const submitEndTurn = (userId: string, expectedVersion: number) =>
      app!.inject({
        method: 'POST',
        url: `/games/${started.gameId}/actions`,
        headers: { authorization: `Bearer ${userId}` },
        payload: { action: { type: 'endTurn' }, expectedVersion, idempotencyKey: idemKey('lobby-endturn') },
      });

    const hostEnds = await submitEndTurn('host-1', 0);
    expect(hostEnds.statusCode).toBe(200);
    // p1 กด endTurn คนเดียว — p2 (มนุษย์) ยังไม่พร้อม ฤดูต้องยังไม่เปลี่ยน
    expect(hostEnds.json().view.turn).toBe(1);

    const p2Ends = await submitEndTurn('p2-user', 1);
    expect(p2Ends.statusCode).toBe(200);
    // ทุกคนพร้อมแล้ว ฤดูคำนวณจริง
    expect(p2Ends.json().view.turn).toBe(2);
  });
});
