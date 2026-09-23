import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CHAPTERS, createGame, earlyRattanakosinChapter } from '@siam/engine';
import type { ChapterDefinition, GameState } from '@siam/engine';
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

describe('cold-start replay จำค่าตั้งเกมได้ครบ (ADR-0007 Addendum 8)', () => {
  it('ตัวจับเวลาฤดูรอด cold-start replay — ไม่กลายเป็น "ไม่จำกัดเวลา" เงียบ ๆ และเริ่มนับฤดูใหม่เต็มช่วง', async () => {
    const parts = await makeAppWithParts({ gameTtlSeconds: 1 });
    app = parts.app;
    const created = await app.games.createFromLobby(
      [
        { userId: 'p1-user', name: 'หนึ่ง' },
        { userId: 'p2-user', name: 'สอง' },
      ],
      777,
      undefined,
      60,
    );
    expect(created.seasonTimerSeconds).toBe(60);

    await sleep(1300);
    expect(await parts.store.getGame(created.gameId)).toBeNull();

    const before = Date.now();
    const res = await app.inject({
      method: 'GET',
      url: `/games/${created.gameId}`,
      headers: { authorization: 'Bearer p1-user' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { seasonTimerSeconds: number | null; seasonDeadline: string | null };
    expect(body.seasonTimerSeconds).toBe(60);
    // deadline ใหม่ = ตอน replay + 60 วินาทีเต็ม (ผู้เล่นได้เวลาเพิ่มได้อย่างเดียว ไม่เสียเวลา)
    const deadline = Date.parse(body.seasonDeadline!);
    expect(deadline).toBeGreaterThanOrEqual(before + 59_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 61_000);
  });

  it('replay จาก genesis สร้างเกมด้วยบทของเกมนั้นเอง ไม่ใช่บท default', async () => {
    const chapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      manifest: { ...earlyRattanakosinChapter.manifest, id: 'replay-test-chapter' },
      rules: {
        ...earlyRattanakosinChapter.rules,
        startResources: { ...earlyRattanakosinChapter.rules.startResources, rice: 999 },
      },
    };
    CHAPTERS[chapter.manifest.id] = chapter;
    try {
      const parts = await makeAppWithParts();
      app = parts.app;
      // เขียนเกมลง Db (ถาวร) ตรง ๆ โดยไม่มีใน store (ร้อน) เลย — บังคับให้ GET ต้อง replay จาก genesis
      const genesis: GameState = createGame({ seed: 99, chapter, humans: [{ id: 'p1', name: 'ทดสอบ' }] });
      const gameId = randomUUID();
      await parts.db.createGame({
        id: gameId,
        engineVersion: '0.1.0',
        seed: 99,
        maxTurn: genesis.maxTurn,
        chapterId: chapter.manifest.id,
        seasonTimerSeconds: undefined,
        createdBy: 'user-1',
        seats: Object.values(genesis.factions).map((f) => ({
          factionId: f.id,
          seat: f.seat,
          name: f.name,
          userId: f.kind === 'human' ? 'user-1' : null,
          ending: null,
        })),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/games/${gameId}`,
        headers: { authorization: 'Bearer user-1' },
      });
      expect(res.statusCode).toBe(200);
      const view = res.json().view as GameState;
      expect(view.chapterId).toBe('replay-test-chapter');
      expect(view.factions.p1!.res.rice).toBe(999);
      expect(res.json().seasonTimerSeconds).toBeNull();
    } finally {
      delete CHAPTERS[chapter.manifest.id];
    }
  });
});
