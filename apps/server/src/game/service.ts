import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION, applyAction, createGame, viewFor, visibleTo } from '@siam/engine';
import type { Action, GameEvent, GameState } from '@siam/engine';
import type { Verifier } from '../auth.js';
import type { Db, DbSeat } from '../db/index.js';
import { AppError, forbidden, notFound, unauthorized, versionConflict } from '../errors.js';
import type { GameRecord, SeatRecord, Store } from '../store/index.js';
import type { CreateGameInput } from '../schemas.js';

export interface GameSnapshot {
  gameId: string;
  version: number;
  seq: number;
  factionId: string;
  view: GameState;
}

/** เฟส 4: ผู้เล่นคือ Supabase user เดียว (ที่นั่งอื่นเป็น AI จนกว่าจะมีห้องรอ/รหัสเชิญในเฟส 5) */
export type CreatedGame = GameSnapshot;

export interface ActionOutcome extends GameSnapshot {
  events: GameEvent[];
  /** true = คำสั่งนี้ถูกส่งซ้ำด้วย idempotencyKey เดิม server ไม่ได้ใช้คำสั่งใหม่ */
  replayed: boolean;
}

type IdempotentResult =
  | { ok: true; outcome: GameSnapshot & { events: GameEvent[] } }
  | { ok: false; status: number; code: string; message: string };

export interface SubmitInput {
  gameId: string;
  factionId: string;
  userId: string;
  action: Action;
  expectedVersion: number;
  idempotencyKey: string;
}

export class GameService {
  constructor(
    private readonly store: Store,
    private readonly db: Db,
    private readonly verifier: Verifier,
  ) {}

  async create(input: CreateGameInput, ownerUserId: string, ownerName: string | null): Promise<CreatedGame> {
    const displayName = input.name?.trim() || ownerName || 'ผู้เล่น';
    return this.createWithHumans([{ userId: ownerUserId, name: displayName }], input.seed, input.maxTurn);
  }

  /** เฟส 5: สร้างเกมจากห้องรอที่ครบที่นั่งแล้ว — เจ้าของห้อง (index 0) ได้ที่นั่ง p1 เสมอ ที่เหลือ p2..p4 ตามลำดับที่เข้าร่วม */
  async createFromLobby(
    seats: { userId: string; name: string }[],
    seed: number | undefined,
    maxTurn: number | undefined,
  ): Promise<CreatedGame> {
    return this.createWithHumans(seats, seed, maxTurn);
  }

  private async createWithHumans(
    humans: { userId: string; name: string }[],
    seed: number | undefined,
    maxTurn: number | undefined,
  ): Promise<CreatedGame> {
    const state = createGame({
      seed,
      maxTurn,
      humans: humans.map((h, i) => ({ id: `p${i + 1}`, name: h.name })),
    });
    const userIdByFaction = new Map<string, string>(humans.map((h, i) => [`p${i + 1}`, h.userId]));
    const owner = state.factions['p1'];
    if (!owner) throw new AppError(500, 'INTERNAL', 'สร้างเกมไม่สำเร็จ');

    const seats: SeatRecord[] = Object.values(state.factions).map((f) => ({
      factionId: f.id,
      seat: f.seat,
      name: f.name,
      userId: f.kind === 'human' ? (userIdByFaction.get(f.id) ?? null) : null,
    }));
    const dbSeats: DbSeat[] = seats.map((s) => ({ ...s, ending: null }));
    const gameId = randomUUID();

    // เขียน Supabase (ถาวร) ก่อน Redis (ร้อน) — ถ้าเขียนไม่สำเร็จจะได้ไม่มีเกมค้างที่ Redis อย่างเดียวจน replay คืนไม่ได้
    try {
      await this.db.createGame({
        id: gameId,
        engineVersion: ENGINE_VERSION,
        seed: seed ?? state.seed,
        maxTurn,
        createdBy: humans[0]!.userId,
        seats: dbSeats,
      });
    } catch (err) {
      throw new AppError(503, 'STORE_UNAVAILABLE', 'บันทึกเกมไม่สำเร็จ ลองใหม่อีกครั้ง', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    const now = new Date().toISOString();
    const record: GameRecord = {
      id: gameId,
      version: 0,
      seq: 0,
      seats,
      state,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.putGame(record);

    return { gameId: record.id, version: 0, seq: 0, factionId: owner.id, view: viewFor(state, owner.id) };
  }

  /** ตรวจ JWT แล้วหาที่นั่งของผู้ใช้คนนี้ในเกม (โยน 401/403/404 ถ้าไม่ผ่าน) */
  async authenticate(
    gameId: string,
    token: string | undefined,
  ): Promise<{ record: GameRecord; factionId: string; userId: string }> {
    if (!token) throw unauthorized();
    const auth = await this.verifier.verify(token);
    const record = await this.loadRecord(gameId);
    if (!record) throw notFound();
    const seat = record.seats.find((s) => s.userId === auth.userId);
    if (!seat) throw forbidden();
    return { record, factionId: seat.factionId, userId: auth.userId };
  }

  /** state ที่ผู้เล่นคนหนึ่งเห็นได้ — server ต้องไม่ส่ง state ดิบออกไป */
  viewOf(state: GameState, factionId: string): GameState {
    return viewFor(state, factionId);
  }

  /** event ที่ผู้เล่นคนหนึ่งเห็นได้ */
  eventsOf(events: GameEvent[], factionId: string): GameEvent[] {
    return events.filter((e) => visibleTo(e, factionId));
  }

  snapshot(record: GameRecord, factionId: string): GameSnapshot {
    return {
      gameId: record.id,
      version: record.version,
      seq: record.seq,
      factionId,
      view: viewFor(record.state, factionId),
    };
  }

  async view(gameId: string, factionId: string): Promise<GameSnapshot> {
    const record = await this.loadRecord(gameId);
    if (!record) throw notFound();
    return this.snapshot(record, factionId);
  }

  async submit(input: SubmitInput): Promise<ActionOutcome> {
    const { gameId, factionId, userId, action, expectedVersion, idempotencyKey } = input;
    return this.store.withLock(gameId, async () => {
      const cached = await this.store.getIdempotent<IdempotentResult>(gameId, idempotencyKey);
      if (cached) {
        if (cached.ok) return { ...cached.outcome, replayed: true };
        throw new AppError(cached.status, cached.code, cached.message);
      }

      const record = await this.loadRecord(gameId);
      if (!record) throw notFound();
      if (!record.seats.some((s) => s.factionId === factionId)) throw forbidden();
      if (record.version !== expectedVersion) {
        throw versionConflict({
          version: record.version,
          seq: record.seq,
          view: viewFor(record.state, factionId),
        });
      }

      const result = applyAction(record.state, factionId, action);
      if (!result.ok) {
        const rejection: IdempotentResult = {
          ok: false,
          status: 422,
          code: result.error,
          message: result.message,
        };
        await this.store.setIdempotent(gameId, idempotencyKey, rejection);
        throw new AppError(422, result.error, result.message);
      }

      const nextSeq = record.seq + 1;
      // เขียน action log ก่อน — ถ้าล้มเหลว Redis ยังไม่ถูกแก้ client retry ด้วย expectedVersion เดิมได้ปลอดภัย
      try {
        await this.db.appendAction({
          gameId,
          seq: nextSeq,
          userId,
          factionId,
          turn: record.state.turn,
          action,
        });
      } catch (err) {
        throw new AppError(503, 'STORE_UNAVAILABLE', 'บันทึกคำสั่งไม่สำเร็จ ลองใหม่อีกครั้ง', {
          cause: err instanceof Error ? err.message : String(err),
        });
      }

      const next: GameRecord = {
        ...record,
        state: result.state,
        version: record.version + 1,
        seq: nextSeq,
        updatedAt: new Date().toISOString(),
      };
      await this.store.putGame(next);

      // snapshot ต้นฤดูใหม่ — best-effort เพราะไม่กระทบความถูกต้อง (replay จาก genesis ได้เสมอ)
      if (next.state.turn !== record.state.turn) {
        void this.db
          .putSnapshot({ gameId, turn: next.state.turn, version: next.version, state: next.state })
          .catch(() => undefined);
      }
      if (next.state.ended && !record.state.ended) {
        const endings: Record<string, string> = {};
        for (const f of Object.values(next.state.factions)) if (f.ending) endings[f.id] = f.ending;
        void this.db.markFinished(gameId, endings).catch(() => undefined);
      }

      const outcome = {
        ...this.snapshot(next, factionId),
        events: result.events.filter((e) => visibleTo(e, factionId)),
      };
      await this.store.setIdempotent(gameId, idempotencyKey, {
        ok: true,
        outcome,
      } satisfies IdempotentResult);
      await this.store.publish(gameId, {
        version: next.version,
        seq: next.seq,
        state: next.state,
        events: result.events,
      });
      return { ...outcome, replayed: false };
    });
  }

  /** Redis มีก็ใช้เลย ไม่มี (TTL หมด/instance ใหม่) ก็โหลด snapshot ล่าสุด + replay action ที่เหลือจาก Supabase */
  private async loadRecord(gameId: string): Promise<GameRecord | null> {
    const cached = await this.store.getGame(gameId);
    if (cached) return cached;

    const data = await this.db.loadForReplay(gameId);
    if (!data) return null;

    const seats: SeatRecord[] = data.seats.map((s) => ({
      factionId: s.factionId,
      seat: s.seat,
      name: s.name,
      userId: s.userId,
    }));

    let state: GameState;
    let version: number;
    if (data.snapshot) {
      state = data.snapshot.state;
      version = data.snapshot.version;
    } else {
      const humans = data.seats
        .filter((s): s is DbSeat & { userId: string } => s.userId !== null)
        .map((s) => ({ id: s.factionId, name: s.name }));
      state = createGame({ seed: data.game.seed ?? undefined, maxTurn: data.game.maxTurn ?? undefined, humans });
      version = 0;
    }

    for (const entry of data.actionsSinceSnapshot) {
      const result = applyAction(state, entry.factionId, entry.action);
      // engine deterministic — replay ควรผ่านเสมอ ถ้าไม่ผ่านก็ข้าม (ดีกว่าล้มทั้งเกม) เก็บ log ไว้สืบสวนภายหลัง
      if (result.ok) {
        state = result.state;
        version = entry.seq;
      }
    }

    const record: GameRecord = {
      id: gameId,
      version,
      seq: version,
      seats,
      state,
      createdAt: data.game.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.store.putGame(record);
    return record;
  }
}
