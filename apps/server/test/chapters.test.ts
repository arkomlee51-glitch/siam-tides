import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GameState } from '@siam/engine';
import { makeApp } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const post = (
  instance: FastifyInstance,
  url: string,
  userId: string,
  payload: Record<string, unknown> = {},
) => instance.inject({ method: 'POST', url, headers: { authorization: `Bearer ${userId}` }, payload });

describe('เลือกบทตอนสร้างเกม/ห้องรอ (ADR-0009)', () => {
  it('POST /games สร้างเกมด้วยบทที่เลือก ไม่ส่ง = บท default', async () => {
    app = await makeApp();
    const chosen = await post(app, '/games', 'u1', { seed: 1, chapterId: 'sukhothai-ayutthaya' });
    expect(chosen.statusCode).toBe(201);
    const view = chosen.json().view as GameState;
    expect(view.chapterId).toBe('sukhothai-ayutthaya');
    expect(view.cities.find((c) => c.owner === 'p1')!.name).toBe('สุโขทัย');

    const plain = await post(app, '/games', 'u2', { seed: 1 });
    expect((plain.json().view as GameState).chapterId).toBe('early-rattanakosin');
  });

  it('บทที่ไม่ได้ลงทะเบียน → 400 ไม่สร้างเกม', async () => {
    app = await makeApp();
    expect((await post(app, '/games', 'u1', { chapterId: 'no-such-chapter' })).statusCode).toBe(400);
    expect((await post(app, '/lobbies', 'u1', { chapterId: 'no-such-chapter' })).statusCode).toBe(400);
  });

  it('ห้องรอจำบทที่เลือก และเกมที่เริ่มจากห้องใช้บทนั้น', async () => {
    app = await makeApp();
    const lobby = await post(app, '/lobbies', 'host', { chapterId: 'sukhothai-ayutthaya' });
    expect(lobby.statusCode).toBe(201);
    const { code, chapterId } = lobby.json() as { code: string; chapterId: string };
    expect(chapterId).toBe('sukhothai-ayutthaya');
    expect((await post(app, `/lobbies/${code}/join`, 'guest')).statusCode).toBe(200);
    const started = await post(app, `/lobbies/${code}/start`, 'host');
    expect(started.statusCode).toBe(201);
    expect((started.json().view as GameState).chapterId).toBe('sukhothai-ayutthaya');

    const defaultLobby = await post(app, '/lobbies', 'host2');
    expect(defaultLobby.json().chapterId).toBe('early-rattanakosin');
  });
});
