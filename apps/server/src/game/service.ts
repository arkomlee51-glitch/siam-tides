import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SEATS, applyAction, createGame, viewFor, visibleTo } from '@siam/engine';
import type { Action, GameEvent, GameState, SeatId } from '@siam/engine';
import { AppError, forbidden, notFound, unauthorized, versionConflict } from '../errors.js';
import type { GameRecord, SeatRecord, Store } from '../store/index.js';
import type { CreateGameInput } from '../schemas.js';

export interface PlayerCredentials {
  factionId: string;
  seat: SeatId;
  name: string;
  /** แสดงครั้งเดียวตอนสร้างเกม — server เก็บแต่ hash (เฟส 4 จะแทนด้วย Supabase JWT) */
  token: string;
}

export interface CreatedGame {
  gameId: string;
  version: number;
  seq: number;
  players: PlayerCredentials[];
  view: GameState;
}

export interface GameSnapshot {
  gameId: string;
  version: number;
  seq: number;
  factionId: string;
  view: GameState;
}

export interface ActionOutcome extends GameSnapshot {
  events: GameEvent[];
  /** true = คำสั่งนี้ถูกส่งซ้ำด้วย idempotencyKey เดิม server ไม่ได้ใช้คำสั่งใหม่ */
  replayed: boolean;
}

type IdempotentResult =
  | { ok: true; outcome: GameSnapshot & { events: GameEvent[] } }
  | { ok: false; status: number; code: string; message: string };

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface SubmitInput {
  gameId: string;
  factionId: string;
  action: Action;
  expectedVersion: number;
  idempotencyKey: string;
}

export class GameService {
  constructor(private readonly store: Store) {}

  async create(input: CreateGameInput): Promise<CreatedGame> {
    const seats = input.players?.length ? input.players : [{}];
    const humans = seats.map((p, i) => ({ id: `p${i + 1}`, name: p.name ?? SEATS[i]?.factionName }));
    const state = createGame({ seed: input.seed, maxTurn: input.maxTurn, humans });

    const records: SeatRecord[] = [];
    const players: PlayerCredentials[] = [];
    for (const human of humans) {
      const faction = state.factions[human.id];
      if (!faction) throw new AppError(500, 'INTERNAL', 'สร้างเกมไม่สำเร็จ');
      const token = randomBytes(24).toString('base64url');
      records.push({
        factionId: faction.id,
        seat: faction.seat,
        name: faction.name,
        tokenHash: sha256(token),
      });
      players.push({ factionId: faction.id, seat: faction.seat, name: faction.name, token });
    }

    const now = new Date().toISOString();
    const record: GameRecord = {
      id: randomUUID(),
      version: 0,
      seq: 0,
      seats: records,
      state,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.putGame(record);

    const first = players[0];
    if (!first) throw new AppError(500, 'INTERNAL', 'สร้างเกมไม่สำเร็จ');
    return {
      gameId: record.id,
      version: record.version,
      seq: record.seq,
      players,
      view: viewFor(state, first.factionId),
    };
  }

  /** คืน factionId ของ token นี้ (โยน 401/403/404 ถ้าไม่ผ่าน) */
  async authenticate(
    gameId: string,
    token: string | undefined,
  ): Promise<{ record: GameRecord; factionId: string }> {
    if (!token) throw unauthorized();
    const record = await this.store.getGame(gameId);
    if (!record) throw notFound();
    const hash = sha256(token);
    const seat = record.seats.find((s) => sameToken(s.tokenHash, hash));
    if (!seat) throw forbidden();
    return { record, factionId: seat.factionId };
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
    const record = await this.store.getGame(gameId);
    if (!record) throw notFound();
    return this.snapshot(record, factionId);
  }

  async submit(input: SubmitInput): Promise<ActionOutcome> {
    const { gameId, factionId, action, expectedVersion, idempotencyKey } = input;
    return this.store.withLock(gameId, async () => {
      const cached = await this.store.getIdempotent<IdempotentResult>(gameId, idempotencyKey);
      if (cached) {
        if (cached.ok) return { ...cached.outcome, replayed: true };
        throw new AppError(cached.status, cached.code, cached.message);
      }

      const record = await this.store.getGame(gameId);
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

      const next: GameRecord = {
        ...record,
        state: result.state,
        version: record.version + 1,
        seq: record.seq + 1,
        updatedAt: new Date().toISOString(),
      };
      await this.store.putGame(next);

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
}
