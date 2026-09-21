import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GameState } from '@siam/engine';
import { idemKey, makeAppWithParts, submit } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getGame = (instance: FastifyInstance, gameId: string, userId: string) =>
  instance.inject({ method: 'GET', url: `/games/${gameId}`, headers: { authorization: `Bearer ${userId}` } });

/**
 * seasonTimerSeconds ผ่าน HTTP ถูกจำกัดขั้นต่ำ 30 วินาที (กันตั้งค่าไร้สาระจากของจริง) —
 * เทสต์นี้เรียก GameService ตรง ๆ (bypass zod) เพื่อใช้ค่าวินาทีสั้น ๆ ทดสอบได้ไวโดยไม่ต้องรอจริงนาน ๆ
 */
describe('จำกัดเวลาต่อฤดู (season timer)', () => {
  it('ยังไม่บังคับ endTurn ถ้ายังไม่หมดเวลา', async () => {
    const parts = await makeAppWithParts();
    app = parts.app;
    const created = await app.games.createFromLobby(
      [
        { userId: 'p1-user', name: 'หนึ่ง' },
        { userId: 'p2-user', name: 'สอง' },
      ],
      1234,
      undefined,
      60, // 60 วินาที — ยังไม่หมดภายในเทสต์นี้แน่ ๆ
    );
    expect(created.seasonTimerSeconds).toBe(60);
    expect(created.seasonDeadline).not.toBeNull();

    await submit(app, { gameId: created.gameId }, 'p1-user', {
      action: { type: 'endTurn' },
      expectedVersion: 0,
      idempotencyKey: idemKey('timer-early'),
    });

    const res = await getGame(app, created.gameId, 'p2-user');
    expect((res.json().view as GameState).turn).toBe(1);
  });

  it('หมดเวลาแล้ว GET ครั้งถัดไปบังคับ endTurn แทนคนที่ยังไม่พร้อม และเลื่อน deadline ของฤดูใหม่', async () => {
    const parts = await makeAppWithParts();
    app = parts.app;
    const created = await app.games.createFromLobby(
      [
        { userId: 'p1-user', name: 'หนึ่ง' },
        { userId: 'p2-user', name: 'สอง' },
      ],
      1234,
      undefined,
      1, // 1 วินาที
    );

    await submit(app, { gameId: created.gameId }, 'p1-user', {
      action: { type: 'endTurn' },
      expectedVersion: 0,
      idempotencyKey: idemKey('timer-p1'),
    });
    // p2 ไม่กด endTurn เลย — จำลองผู้เล่นหาย/ไม่ตอบสนอง

    await sleep(1200);

    const afterTimeout = await getGame(app, created.gameId, 'p1-user');
    expect(afterTimeout.statusCode).toBe(200);
    const view = afterTimeout.json().view as GameState;
    expect(view.turn).toBe(2); // ฤดูข้ามไปแล้วแม้ p2 ไม่ได้กดเอง
    expect(view.ready).toHaveLength(0);
    expect(afterTimeout.json().seasonDeadline).not.toBeNull();
    expect(Date.parse(afterTimeout.json().seasonDeadline)).toBeGreaterThan(Date.now());

    // เกมยังเล่นต่อได้ตามปกติหลังตัวจับเวลาบังคับฤดูใหม่ — version เดินต่อ ไม่ย้อนกลับ
    const next = await submit(app, { gameId: created.gameId }, 'p2-user', {
      action: { type: 'endTurn' },
      expectedVersion: afterTimeout.json().version,
      idempotencyKey: idemKey('timer-continue'),
    });
    expect(next.statusCode).toBe(200);
  });

  it('ตัวจับเวลาก็จบเกมได้เหมือน endTurn ปกติเมื่อถึง maxTurn และคำนวณ ending ให้ทุกคน', async () => {
    const parts = await makeAppWithParts();
    app = parts.app;
    const created = await app.games.createFromLobby(
      [
        { userId: 'p1-user', name: 'หนึ่ง' },
        { userId: 'p2-user', name: 'สอง' },
      ],
      1234,
      1, // maxTurn = 1 ฤดูเดียวจบ
      1,
    );

    await submit(app, { gameId: created.gameId }, 'p1-user', {
      action: { type: 'endTurn' },
      expectedVersion: 0,
      idempotencyKey: idemKey('timer-end-p1'),
    });
    await sleep(1200);

    const res = await getGame(app, created.gameId, 'p1-user');
    const view = res.json().view as GameState;
    expect(view.ended).toBe(true);
    expect(view.factions.p1!.ending).not.toBeNull();
    expect(view.factions.p2!.ending).not.toBeNull();
    // จบเกมแล้ว ไม่มีฤดูให้จำกัดเวลาอีก
    expect(res.json().seasonDeadline).toBeNull();

    // เช็คซ้ำอีกครั้งต้องไม่พัง/ไม่พยายามบังคับ endTurn อีกเพราะเกมจบไปแล้ว (isSeasonTimerDue ต้องเป็น false)
    const again = await getGame(app, created.gameId, 'p1-user');
    expect(again.statusCode).toBe(200);
    expect((again.json().view as GameState).ended).toBe(true);
  });
});
