import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createGame, mergeLegacyBonuses } from '@siam/engine';
import type { GameState, LegacyBonus } from '@siam/engine';
import { createMemoryDb } from '../src/db/index.js';
import type { Db } from '../src/db/index.js';
import { idemKey, makeAppWithParts, submit } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** recordFinish เขียน Legacy แบบ best-effort (ไม่ block response) — รอจนเห็นใน Db */
async function waitForLegacy(db: Db, userId: string) {
  for (let i = 0; i < 50; i++) {
    const found = (await db.loadLatestLegacy([userId])).get(userId);
    if (found) return found;
    await sleep(20);
  }
  throw new Error(`Legacy ของ ${userId} ไม่ถูกบันทึก`);
}

const getView = async (instance: FastifyInstance, gameId: string, userId: string) => {
  const res = await instance.inject({
    method: 'GET',
    url: `/games/${gameId}`,
    headers: { authorization: `Bearer ${userId}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json().view as GameState;
};

describe('Legacy ข้ามบท — จบเกม → บันทึก, เริ่มเกมใหม่ → ได้โบนัส (ADR-0007 Addendum 9)', () => {
  it('จบเกมแล้วบันทึก Legacy ของผู้เล่นแต่ละคน และเกมถัดไปของคนนั้นได้โบนัสจริง ส่วนคนที่ไม่มี Legacy ไม่ได้', async () => {
    const parts = await makeAppWithParts({ gameTtlSeconds: 1 });
    app = parts.app;

    // เกมที่ 1: เล่นคนเดียว maxTurn 1 — endTurn ครั้งเดียวก็จบเกม
    const first = await app.games.createFromLobby(
      [{ userId: 'veteran', name: 'ทหารผ่านศึก' }],
      11,
      1,
      undefined,
    );
    const end = await submit(app, { gameId: first.gameId }, 'veteran', {
      action: { type: 'endTurn' },
      expectedVersion: 0,
      idempotencyKey: idemKey('legacy-end-1'),
    });
    expect(end.statusCode).toBe(200);
    expect((end.json().view as GameState).ended).toBe(true);

    const saved = await waitForLegacy(parts.db, 'veteran');
    expect(saved.chapterId).toBe('early-rattanakosin');
    expect(saved.sourceGameId).toBe(first.gameId);
    expect(saved.bonuses.length).toBeGreaterThan(0);

    // เกมที่ 2: veteran (มี Legacy) กับ rookie (ไม่มี)
    const second = await app.games.createFromLobby(
      [
        { userId: 'veteran', name: 'ทหารผ่านศึก' },
        { userId: 'rookie', name: 'มือใหม่' },
      ],
      22,
      undefined,
      undefined,
    );
    const view = await getView(app, second.gameId, 'veteran');
    expect(view.factions.p1!.legacy?.totals).toEqual(mergeLegacyBonuses(saved.bonuses));
    expect(view.factions.p2!.legacy).toBeUndefined();

    // ที่นั่งใน Db เก็บ Legacy ที่ใช้จริงไว้ให้ replay
    const replayData = await parts.db.loadForReplay(second.gameId);
    expect(replayData!.seats.find((s) => s.factionId === 'p1')!.legacy).toEqual(
      mergeLegacyBonuses(saved.bonuses),
    );
    expect(replayData!.seats.find((s) => s.factionId === 'p2')!.legacy).toBeNull();

    // cold-start replay จาก genesis ต้องได้เกมเดิมเป๊ะ รวม Legacy (ไม่อ่าน player_legacy ใหม่)
    await sleep(1300);
    expect(await parts.store.getGame(second.gameId)).toBeNull();
    expect(await getView(app, second.gameId, 'veteran')).toEqual(view);
  });

  it('เกมที่ได้ Legacy ต่างจากเกมเดียวกันที่ไม่ได้ Legacy ตรงตามที่เอนจินคำนวณ', async () => {
    const parts = await makeAppWithParts();
    app = parts.app;
    const bonuses: LegacyBonus[] = [
      { category: 'military', amount: 0.1, sourceChapterId: 'early-rattanakosin', note: 'ทดสอบ' },
    ];
    await parts.db.upsertLegacy([
      { userId: 'u1', chapterId: 'early-rattanakosin', bonuses, sourceGameId: null },
    ]);
    const created = await app.games.createFromLobby(
      [{ userId: 'u1', name: 'หนึ่ง' }],
      5,
      undefined,
      undefined,
    );
    const view = await getView(app, created.gameId, 'u1');
    const expected = createGame({
      seed: 5,
      humans: [{ id: 'p1', name: 'หนึ่ง', legacy: mergeLegacyBonuses(bonuses) }],
    });
    expect(view.armies.find((a) => a.owner === 'p1')!.str).toBe(
      expected.armies.find((a) => a.owner === 'p1')!.str,
    );
    expect(view.factions.p1!.legacy).toEqual(expected.factions.p1!.legacy);
  });
});

describe('loadLatestLegacy ใช้บทล่าสุดที่เล่นจบ', () => {
  it('คืนแถวที่เขียนล่าสุดของผู้เล่นแต่ละคน ข้ามบทได้ และเล่นบทเดิมซ้ำคือทับแถวเดิม', async () => {
    const db = createMemoryDb();
    const b = (note: string): LegacyBonus[] => [
      { category: 'knowledge', amount: 0.05, sourceChapterId: 'x', note },
    ];
    await db.upsertLegacy([{ userId: 'u1', chapterId: 'chapter-a', bonuses: b('A1'), sourceGameId: null }]);
    await db.upsertLegacy([{ userId: 'u1', chapterId: 'chapter-b', bonuses: b('B1'), sourceGameId: null }]);
    expect((await db.loadLatestLegacy(['u1'])).get('u1')!.chapterId).toBe('chapter-b');

    await db.upsertLegacy([{ userId: 'u1', chapterId: 'chapter-a', bonuses: b('A2'), sourceGameId: null }]);
    const latest = (await db.loadLatestLegacy(['u1', 'nobody'])).get('u1')!;
    expect(latest.chapterId).toBe('chapter-a');
    expect(latest.bonuses[0]!.note).toBe('A2');
    expect((await db.loadLatestLegacy(['nobody'])).size).toBe(0);
  });
});
