import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { GameState } from '@siam/engine';
import { armyOf, idemKey, makeAppWithParts, submit } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface LobbyBody {
  code: string;
  hostUserId: string;
  seats: { userId: string; name: string }[];
  startedGameId: string | null;
}
interface CreatedGame {
  gameId: string;
  version: number;
  seq: number;
  factionId: string;
  view: GameState;
}

const createLobby = (app: FastifyInstance, userId: string, payload: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/lobbies',
    headers: { authorization: `Bearer ${userId}` },
    payload,
  });

const joinLobby = (app: FastifyInstance, code: string, userId: string) =>
  app.inject({
    method: 'POST',
    url: `/lobbies/${code}/join`,
    headers: { authorization: `Bearer ${userId}` },
    payload: {},
  });

const startLobby = (app: FastifyInstance, code: string, userId: string) =>
  app.inject({
    method: 'POST',
    url: `/lobbies/${code}/start`,
    headers: { authorization: `Bearer ${userId}` },
  });

const getGame = (app: FastifyInstance, gameId: string, userId: string) =>
  app.inject({ method: 'GET', url: `/games/${gameId}`, headers: { authorization: `Bearer ${userId}` } });

/** ตั้งห้องรอ 3 คน (host + p2 + p3) แล้วเริ่มเกม คืน gameId + factionId ของแต่ละคน */
async function startThreeHumanGame(
  instance: FastifyInstance,
  opts: Record<string, unknown> = {},
): Promise<{ gameId: string; p1: string; p2: string; p3: string }> {
  const created = (await createLobby(instance, 'host-1', opts)).json() as LobbyBody;
  await joinLobby(instance, created.code, 'p2-user');
  await joinLobby(instance, created.code, 'p3-user');
  const started = (await startLobby(instance, created.code, 'host-1')).json() as CreatedGame;
  return { gameId: started.gameId, p1: 'host-1', p2: 'p2-user', p3: 'p3-user' };
}

describe('การทูตระหว่างมนุษย์กับมนุษย์ (เสนอสงบศึก)', () => {
  it('เสนอสงบศึกต้องให้อีกฝ่ายตอบรับเอง และคนที่สามมองไม่เห็นข้อเสนอ', async () => {
    const parts = await makeAppWithParts();
    app = parts.app;
    const { gameId, p1, p2, p3 } = await startThreeHumanGame(app, { seed: 9 });

    const declareWar = await submit(app, { gameId }, p1, {
      action: { type: 'declareWar', target: 'p2' },
      expectedVersion: 0,
      idempotencyKey: idemKey('mp-war'),
    });
    expect(declareWar.statusCode).toBe(200);

    const propose = await submit(app, { gameId }, p1, {
      action: { type: 'proposePeace', target: 'p2' },
      expectedVersion: 1,
      idempotencyKey: idemKey('mp-propose'),
    });
    expect(propose.statusCode).toBe(200);
    const proposalId = (propose.json().view as GameState).proposals.find((p) => p.from === 'p1')!.id;

    // p2 (ผู้รับ) เห็นข้อเสนอ
    const p2View = (await getGame(app, gameId, p2)).json();
    expect(p2View.view.proposals).toHaveLength(1);
    // p3 ไม่เกี่ยวข้องด้วย — ต้องไม่เห็นข้อเสนอระหว่าง p1/p2 เลย
    const p3View = (await getGame(app, gameId, p3)).json();
    expect(p3View.view.proposals).toHaveLength(0);

    const accept = await submit(app, { gameId }, p2, {
      action: { type: 'answerProposal', proposalId, accept: true },
      expectedVersion: p2View.version,
      idempotencyKey: idemKey('mp-accept'),
    });
    expect(accept.statusCode).toBe(200);
    const afterView = accept.json().view as GameState;
    expect(afterView.proposals).toHaveLength(0);
    expect(afterView.relations['p1|p2']?.war).toBe(false);
  });

  it('ปฏิเสธข้อเสนอแล้วยังอยู่ในภาวะสงครามต่อ', async () => {
    const parts = await makeAppWithParts();
    app = parts.app;
    const { gameId, p1, p2 } = await startThreeHumanGame(app, { seed: 10 });

    await submit(app, { gameId }, p1, {
      action: { type: 'declareWar', target: 'p2' },
      expectedVersion: 0,
      idempotencyKey: idemKey('mp-war2'),
    });
    const propose = await submit(app, { gameId }, p1, {
      action: { type: 'proposePeace', target: 'p2' },
      expectedVersion: 1,
      idempotencyKey: idemKey('mp-propose2'),
    });
    const view = propose.json().view as GameState;
    const proposalId = view.proposals.find((p) => p.from === 'p1')!.id;

    const decline = await submit(app, { gameId }, p2, {
      action: { type: 'answerProposal', proposalId, accept: false },
      expectedVersion: 2,
      idempotencyKey: idemKey('mp-decline'),
    });
    expect(decline.statusCode).toBe(200);
    const after = decline.json().view as GameState;
    expect(after.relations['p1|p2']?.war).toBe(true);
    expect(after.proposals).toHaveLength(0);
  });
});

describe('ตอนจบเกมหลายคน', () => {
  it('แต่ละมนุษย์ได้ ending ของตัวเองอิสระจากกันเมื่อครบฤดู', async () => {
    const parts = await makeAppWithParts();
    app = parts.app;
    const { gameId, p1, p2 } = await startThreeHumanGame(app, { seed: 55, maxTurn: 1 });

    const endTurn = (userId: string, expectedVersion: number) =>
      submit(app!, { gameId }, userId, {
        action: { type: 'endTurn' },
        expectedVersion,
        idempotencyKey: idemKey(`mp-end-${userId}`),
      });

    await endTurn(p1, 0);
    // p2 และ p3 ยังไม่ ready — ฤดูยังไม่ข้าม เกมยังไม่จบ
    const midView = (await getGame(app, gameId, p1)).json();
    expect(midView.view.ended).toBe(false);

    await endTurn('p2-user', 1);
    const last = await endTurn('p3-user', 2);
    const final = last.json().view as GameState;
    expect(final.ended).toBe(true);
    expect(final.factions.p1!.ending).not.toBeNull();
    expect(final.factions.p2!.ending).not.toBeNull();
    expect(final.factions.p3!.ending).not.toBeNull();

    // แต่ละคนเห็น ending ของตัวเองผ่าน view ของตัวเองเช่นกัน (ไม่ใช่แค่ใน state ดิบ)
    const p2Own = (await getGame(app, gameId, p2)).json();
    expect(p2Own.view.factions.p2!.ending).toBe(final.factions.p2!.ending);
  });
});

describe('reconnect เกมหลายคน (cold-start replay ต่อผู้เล่นมากกว่าหนึ่งคน)', () => {
  it('ทั้งสองคนยังได้ view ของตัวเองถูกต้องหลัง store ร้อนลืมเกมไปแล้ว', async () => {
    const parts = await makeAppWithParts({ gameTtlSeconds: 1 });
    app = parts.app;
    const { gameId, p1, p2 } = await startThreeHumanGame(app, { seed: 21 });

    const p1Before = (await getGame(app, gameId, p1)).json();
    const army = armyOf(p1Before.view as GameState, 'p1');
    const camp = await submit(app, { gameId }, p1, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: p1Before.version,
      idempotencyKey: idemKey('mp-replay-camp'),
    });
    expect(camp.statusCode).toBe(200);

    const p2Before = (await getGame(app, gameId, p2)).json();

    // จำลอง Redis/memory store หมดอายุ — เหลือแค่ Db ถาวรที่ยังมีเกมนี้
    await sleep(1300);
    expect(await parts.store.getGame(gameId)).toBeNull();

    const p1After = await getGame(app, gameId, p1);
    expect(p1After.statusCode).toBe(200);
    expect(p1After.json().view).toEqual(camp.json().view);

    // p2 (ไม่ใช่คนที่ทำ action ล่าสุด) ก็ยัง reconnect ได้ view ของตัวเองถูกต้องเหมือนกัน
    const p2After = await getGame(app, gameId, p2);
    expect(p2After.statusCode).toBe(200);
    expect(p2After.json().version).toBe(p1After.json().version);
    expect(p2After.json().view.factions.p2).toEqual(p2Before.view.factions.p2);

    // ยังเล่นต่อได้ตามปกติหลัง reconnect — version เดินต่อ ไม่ย้อนกลับ
    const p2Army = armyOf(p2After.json().view as GameState, 'p2');
    const next = await submit(app, { gameId }, p2, {
      action: { type: 'camp', armyId: p2Army.id },
      expectedVersion: p2After.json().version,
      idempotencyKey: idemKey('mp-replay-continue'),
    });
    expect(next.statusCode).toBe(200);
  });
});
