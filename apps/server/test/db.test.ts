import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '@siam/engine';
import type { Action, GameState } from '@siam/engine';
import { createMemoryDb } from '../src/db/memory.js';

describe('MemoryDb — contract', () => {
  it('createGame แล้ว loadForReplay เจอ game/seats แต่ snapshot ยังเป็น null', async () => {
    const db = createMemoryDb();
    const id = randomUUID();
    await db.createGame({
      id,
      engineVersion: '0.1.0',
      seed: 42,
      maxTurn: 30,
      chapterId: 'early-rattanakosin',
      seasonTimerSeconds: 90,
      createdBy: 'user-1',
      seats: [
        { factionId: 'p1', seat: 'center', name: 'ผู้เล่น', userId: 'user-1', ending: null },
        { factionId: 'north', seat: 'north', name: 'เชียงดาว', userId: null, ending: null },
      ],
    });
    const data = await db.loadForReplay(id);
    expect(data?.game.seed).toBe(42);
    // ค่าตั้งเกมที่ replay ต้องใช้ ต้องกลับมาครบ (ADR-0007 Addendum 8)
    expect(data?.game.chapterId).toBe('early-rattanakosin');
    expect(data?.game.seasonTimerSeconds).toBe(90);
    expect(data?.seats).toHaveLength(2);
    expect(data?.snapshot).toBeNull();
    expect(data?.actionsSinceSnapshot).toEqual([]);
  });

  it('คืน null เมื่อไม่มีเกมนั้น', async () => {
    const db = createMemoryDb();
    expect(await db.loadForReplay(randomUUID())).toBeNull();
  });

  it('appendAction สะสมและ loadForReplay กรองตาม snapshot.version', async () => {
    const db = createMemoryDb();
    const id = randomUUID();
    const genesis = createGame({ seed: 1 });
    await db.createGame({
      id,
      engineVersion: '0.1.0',
      seed: 1,
      maxTurn: 30,
      chapterId: 'early-rattanakosin',
      seasonTimerSeconds: undefined,
      createdBy: 'u',
      seats: [],
    });
    await db.appendAction({
      gameId: id,
      seq: 1,
      userId: 'u',
      factionId: 'p1',
      turn: 1,
      action: { type: 'endTurn' },
    });
    await db.appendAction({
      gameId: id,
      seq: 2,
      userId: 'u',
      factionId: 'p1',
      turn: 1,
      action: { type: 'endTurn' },
    });
    await db.putSnapshot({ gameId: id, turn: 2, version: 1, state: genesis });
    await db.appendAction({
      gameId: id,
      seq: 3,
      userId: 'u',
      factionId: 'p1',
      turn: 2,
      action: { type: 'endTurn' },
    });

    const data = await db.loadForReplay(id);
    expect(data?.snapshot?.version).toBe(1);
    expect(data?.actionsSinceSnapshot.map((a) => a.seq)).toEqual([2, 3]);
  });

  it('markFinished ตั้ง status ของเกมและ ending ต่อที่นั่ง', async () => {
    const db = createMemoryDb();
    const id = randomUUID();
    await db.createGame({
      id,
      engineVersion: '0.1.0',
      seed: 1,
      maxTurn: 30,
      chapterId: 'early-rattanakosin',
      seasonTimerSeconds: undefined,
      createdBy: 'u',
      seats: [{ factionId: 'p1', seat: 'center', name: 'x', userId: 'u', ending: null }],
    });
    await db.markFinished(id, { p1: 'empire' });
    const data = await db.loadForReplay(id);
    expect(data?.game.status).toBe('finished');
    expect(data?.game.finishedAt).not.toBeNull();
    expect(data?.seats.find((s) => s.factionId === 'p1')?.ending).toBe('empire');
  });
});

describe('replay ต้องได้ state เท่าเดิมกับเล่นต่อเนื่อง (ดู ADR-0004 / ROADMAP เฟส 4)', () => {
  it('snapshot ต้นฤดู + replay action ที่เหลือ ให้ state เดียวกับเล่นสดต่อเนื่อง', () => {
    let live: GameState = createGame({ seed: 555, humans: [{ id: 'p1', name: 'ทดสอบ' }] });
    const log: { seq: number; factionId: string; action: Action }[] = [];
    let seq = 0;
    let snapshotAt: { version: number; state: GameState } | null = null;

    const armyId = live.armies.find((a) => a.owner === 'p1')!.id;
    const actions: Action[] = [
      { type: 'camp', armyId },
      { type: 'endTurn' },
      { type: 'camp', armyId },
      { type: 'endTurn' },
    ];

    for (const action of actions) {
      const beforeTurn = live.turn;
      const result = applyAction(live, 'p1', action);
      if (!result.ok) throw new Error(`unreachable: ${result.message}`);
      seq += 1;
      log.push({ seq, factionId: 'p1', action });
      live = result.state;
      if (live.turn !== beforeTurn && !snapshotAt) {
        // เอา snapshot แรกที่เจอ (ต้นฤดูที่ 2) มาใช้ทดสอบ replay จากกลางเกม ไม่ใช่จาก genesis
        snapshotAt = { version: seq, state: live };
      }
    }

    expect(snapshotAt).not.toBeNull();

    let replayed = snapshotAt!.state;
    for (const entry of log.filter((e) => e.seq > snapshotAt!.version)) {
      const result = applyAction(replayed, entry.factionId, entry.action);
      if (!result.ok) throw new Error(`unreachable: ${result.message}`);
      replayed = result.state;
    }

    expect(replayed).toEqual(live);
  });

  it('replay ผ่าน MemoryDb.loadForReplay ให้ state เดียวกับที่เก็บไว้จริง', async () => {
    const db = createMemoryDb();
    const id = randomUUID();
    // seed/ลำดับคำสั่งเดียวกับเทสต์ข้างบน — รู้อยู่แล้วว่าไม่ชนข้อเสนอมหาอำนาจที่ต้องตอบก่อน (pending decision)
    let state: GameState = createGame({ seed: 555, humans: [{ id: 'p1', name: 'ทดสอบ' }] });
    await db.createGame({
      id,
      engineVersion: '0.1.0',
      seed: 555,
      maxTurn: state.maxTurn,
      chapterId: state.chapterId,
      seasonTimerSeconds: undefined,
      createdBy: 'u',
      seats: Object.values(state.factions).map((f) => ({
        factionId: f.id,
        seat: f.seat,
        name: f.name,
        userId: f.kind === 'human' ? 'u' : null,
        ending: null,
      })),
    });

    const armyId = state.armies.find((a) => a.owner === 'p1')!.id;
    const actionsInOrder: Action[] = [
      { type: 'camp', armyId },
      { type: 'endTurn' },
      { type: 'camp', armyId },
      { type: 'endTurn' },
    ];
    let seq = 0;
    let snapshotTaken = false;
    for (const action of actionsInOrder) {
      const beforeTurn = state.turn;
      const result = applyAction(state, 'p1', action);
      if (!result.ok) throw new Error(`unreachable: ${result.message}`);
      seq += 1;
      await db.appendAction({ gameId: id, seq, userId: 'u', factionId: 'p1', turn: beforeTurn, action });
      state = result.state;
      if (state.turn !== beforeTurn && !snapshotTaken) {
        await db.putSnapshot({ gameId: id, turn: state.turn, version: seq, state });
        snapshotTaken = true;
      }
    }

    const data = await db.loadForReplay(id);
    expect(data?.snapshot).not.toBeNull();
    let rebuilt = data!.snapshot!.state;
    for (const entry of data!.actionsSinceSnapshot) {
      const result = applyAction(rebuilt, entry.factionId, entry.action);
      if (!result.ok) throw new Error(`unreachable: ${result.message}`);
      rebuilt = result.state;
    }
    expect(rebuilt).toEqual(state);
  });
});
