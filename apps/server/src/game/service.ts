import { randomUUID } from 'node:crypto';
import {
  ENGINE_VERSION,
  LEGACY_CATEGORIES,
  applyAction,
  computeLegacyBonuses,
  createGame,
  getChapterById,
  mergeLegacyBonuses,
  viewFor,
  visibleTo,
} from '@siam/engine';
import type { Action, GameEvent, GameState } from '@siam/engine';
import type { Verifier } from '../auth.js';
import type { Db, DbSeat, LegacyRecord } from '../db/index.js';
import { AppError, forbidden, notFound, unauthorized, versionConflict } from '../errors.js';
import type { GameRecord, SeatRecord, Store } from '../store/index.js';
import type { CreateGameInput } from '../schemas.js';

export interface GameSnapshot {
  gameId: string;
  version: number;
  seq: number;
  factionId: string;
  view: GameState;
  /** null = ไม่จำกัดเวลาต่อฤดู */
  seasonTimerSeconds: number | null;
  /** เวลา (ISO) ที่ฤดูนี้จะถูกบังคับจบถ้ายังมีมนุษย์ไม่ ready */
  seasonDeadline: string | null;
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
    return this.createWithHumans(
      [{ userId: ownerUserId, name: displayName }],
      input.seed,
      input.maxTurn,
      undefined,
      input.chapterId,
    );
  }

  /** เฟส 5: สร้างเกมจากห้องรอที่ครบที่นั่งแล้ว — เจ้าของห้อง (index 0) ได้ที่นั่ง p1 เสมอ ที่เหลือ p2..p4 ตามลำดับที่เข้าร่วม */
  async createFromLobby(
    seats: { userId: string; name: string }[],
    seed: number | undefined,
    maxTurn: number | undefined,
    seasonTimerSeconds: number | undefined,
    chapterId?: string,
  ): Promise<CreatedGame> {
    return this.createWithHumans(seats, seed, maxTurn, seasonTimerSeconds, chapterId);
  }

  private async createWithHumans(
    humans: { userId: string; name: string }[],
    seed: number | undefined,
    maxTurn: number | undefined,
    seasonTimerSeconds: number | undefined,
    /** undefined = บท default; ต้องเป็นบทที่ลงทะเบียนแล้ว (schema ตรวจไว้ก่อนถึงตรงนี้) */
    chapterId: string | undefined,
  ): Promise<CreatedGame> {
    // Legacy: ผู้เล่นแต่ละคนได้โบนัสจากบทล่าสุดที่ตัวเองเล่นจบ (ADR-0007 Addendum 9)
    let legacyByUser: Map<string, LegacyRecord>;
    try {
      legacyByUser = await this.db.loadLatestLegacy(humans.map((h) => h.userId));
    } catch (err) {
      throw new AppError(503, 'STORE_UNAVAILABLE', 'โหลดข้อมูล Legacy ไม่สำเร็จ ลองใหม่อีกครั้ง', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    const legacyFor = (userId: string) => {
      const record = legacyByUser.get(userId);
      if (!record) return undefined;
      const totals = mergeLegacyBonuses(record.bonuses);
      return LEGACY_CATEGORIES.some((c) => totals[c] > 0) ? totals : undefined;
    };
    const state = createGame({
      seed,
      maxTurn,
      humans: humans.map((h, i) => ({ id: `p${i + 1}`, name: h.name, legacy: legacyFor(h.userId) })),
      chapter: chapterId ? getChapterById(chapterId) : undefined,
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
    // เก็บ Legacy ที่ใช้จริง (หลัง clamp) ต่อที่นั่ง — replay ต้องใช้ค่านี้ ไม่อ่าน player_legacy ใหม่
    const dbSeats: DbSeat[] = seats.map((s) => ({
      ...s,
      ending: null,
      legacy: state.factions[s.factionId]?.legacy?.totals ?? null,
    }));
    const gameId = randomUUID();

    // เขียน Supabase (ถาวร) ก่อน Redis (ร้อน) — ถ้าเขียนไม่สำเร็จจะได้ไม่มีเกมค้างที่ Redis อย่างเดียวจน replay คืนไม่ได้
    try {
      await this.db.createGame({
        id: gameId,
        engineVersion: ENGINE_VERSION,
        seed: seed ?? state.seed,
        maxTurn,
        chapterId: state.chapterId,
        seasonTimerSeconds,
        createdBy: humans[0]!.userId,
        seats: dbSeats,
      });
    } catch (err) {
      throw new AppError(503, 'STORE_UNAVAILABLE', 'บันทึกเกมไม่สำเร็จ ลองใหม่อีกครั้ง', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    const now = new Date().toISOString();
    const seasonDeadline = seasonTimerSeconds
      ? new Date(Date.now() + seasonTimerSeconds * 1000).toISOString()
      : null;
    const record: GameRecord = {
      id: gameId,
      version: 0,
      seq: 0,
      seats,
      state,
      createdAt: now,
      updatedAt: now,
      seasonTimerSeconds: seasonTimerSeconds ?? null,
      seasonDeadline,
    };
    await this.store.putGame(record);

    return {
      gameId: record.id,
      version: 0,
      seq: 0,
      factionId: owner.id,
      view: viewFor(state, owner.id),
      seasonTimerSeconds: record.seasonTimerSeconds,
      seasonDeadline: record.seasonDeadline,
    };
  }

  /** ตรวจ JWT แล้วหาที่นั่งของผู้ใช้คนนี้ในเกม (โยน 401/403/404 ถ้าไม่ผ่าน) */
  async authenticate(
    gameId: string,
    token: string | undefined,
  ): Promise<{ record: GameRecord; factionId: string; userId: string }> {
    if (!token) throw unauthorized();
    const auth = await this.verifier.verify(token);
    let record = await this.loadRecord(gameId);
    if (!record) throw notFound();
    record = await this.maybeExpireSeason(record);
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
      seasonTimerSeconds: record.seasonTimerSeconds,
      seasonDeadline: record.seasonDeadline,
    };
  }

  async view(gameId: string, factionId: string): Promise<GameSnapshot> {
    let record = await this.loadRecord(gameId);
    if (!record) throw notFound();
    record = await this.maybeExpireSeason(record);
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

      let record = await this.loadRecord(gameId);
      if (!record) throw notFound();
      // per-game lock ถูกถืออยู่แล้ว (store.withLock ด้านบน) — เรียกตรง ๆ ได้โดยไม่ต้องล็อกซ้ำ
      record = await this.expireSeasonIfDue(record);
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
      if (next.state.ended && !record.state.ended) this.recordFinish(next);

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
        .map((s) => ({ id: s.factionId, name: s.name, legacy: s.legacy ?? undefined }));
      // null chapterId = เกมก่อนเฟส 6 → บท default ของ createGame; id ที่ไม่ได้ลงทะเบียนจะ throw ชัด ๆ
      // (ดีกว่า replay ด้วยบทผิดเงียบ ๆ)
      state = createGame({
        seed: data.game.seed ?? undefined,
        maxTurn: data.game.maxTurn ?? undefined,
        humans,
        chapter: data.game.chapterId ? getChapterById(data.game.chapterId) : undefined,
      });
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
      // เก็บแค่วินาทีต่อฤดูใน Supabase ไม่เก็บ deadline — replay เริ่มนับฤดูปัจจุบันใหม่เต็มช่วง
      // (ผู้เล่นได้เวลาเพิ่มได้อย่างเดียว ไม่มีทางเสียเวลา) ดู ADR-0007 Addendum 8
      seasonTimerSeconds: data.game.seasonTimerSeconds,
      seasonDeadline:
        data.game.seasonTimerSeconds && !state.ended
          ? new Date(Date.now() + data.game.seasonTimerSeconds * 1000).toISOString()
          : null,
    };
    await this.store.putGame(record);
    return record;
  }

  /**
   * เกมเพิ่งจบ: ปิดเกมใน DB และบันทึก Legacy ของผู้เล่นมนุษย์ทุกคนไว้ใช้ในบทถัดไป — best-effort ทั้งคู่
   * (ไม่ block response) บันทึกแม้ Legacy ว่าง เพราะกติกาคือ "ใช้บทล่าสุดที่เล่นจบ" — ถ้าข้ามแถวว่างไป
   * ผู้เล่นจะได้ Legacy ของบทเก่ากว่ามาแทนผิดกติกา
   */
  private recordFinish(record: GameRecord): void {
    const { state } = record;
    const endings: Record<string, string> = {};
    for (const f of Object.values(state.factions)) if (f.ending) endings[f.id] = f.ending;
    void this.db.markFinished(record.id, endings).catch(() => undefined);
    const legacy = record.seats
      .filter((s): s is typeof s & { userId: string } => s.userId !== null)
      .map((s) => ({
        userId: s.userId,
        chapterId: state.chapterId,
        bonuses: computeLegacyBonuses(state, state.chapterId, s.factionId),
        sourceGameId: record.id,
      }));
    void this.db.upsertLegacy(legacy).catch(() => undefined);
  }

  /** true = ตั้งเวลาไว้ และเวลาต่อฤดูปัจจุบันหมดแล้ว แต่ยังมีมนุษย์ไม่ ready */
  private isSeasonTimerDue(record: GameRecord): boolean {
    return (
      !record.state.ended &&
      record.seasonTimerSeconds !== null &&
      record.seasonDeadline !== null &&
      Date.parse(record.seasonDeadline) <= Date.now()
    );
  }

  /** เรียกจากที่ที่ยังไม่ได้ถือ per-game lock (GET/ws sync) — ล็อกเองเฉพาะตอนที่ต้องแก้จริง ๆ */
  private async maybeExpireSeason(record: GameRecord): Promise<GameRecord> {
    if (!this.isSeasonTimerDue(record)) return record;
    return this.store.withLock(record.id, async () => {
      const fresh = (await this.loadRecord(record.id)) ?? record;
      return this.expireSeasonIfDue(fresh);
    });
  }

  /**
   * บังคับ endTurn แทนมนุษย์ที่ยังไม่ ready เมื่อหมดเวลาต่อฤดู — ผ่าน applyAction ตัวเดียวกับคำสั่งปกติทุกประการ
   * (บันทึก action log ก่อนเสมอ เพื่อให้ cold-start replay ย้อนสร้างผลลัพธ์เดียวกันได้) เรียกได้เฉพาะตอนถือ
   * per-game lock อยู่แล้วเท่านั้น (submit() ถืออยู่แล้ว, maybeExpireSeason ล็อกให้ก่อนเรียก)
   */
  private async expireSeasonIfDue(record: GameRecord): Promise<GameRecord> {
    if (!this.isSeasonTimerDue(record)) return record;
    const seasonTimerSeconds = record.seasonTimerSeconds!;
    let state = record.state;
    let version = record.version;
    let seq = record.seq;
    const laggards = state.order.filter(
      (id) => state.factions[id]!.kind === 'human' && state.factions[id]!.alive && !state.ready.includes(id),
    );
    for (const factionId of laggards) {
      if (state.ended) break;
      const result = applyAction(state, factionId, { type: 'endTurn' });
      if (!result.ok) continue; // ไม่ควรเกิดกับ endTurn แต่กันเหนียวไม่ให้ตัวจับเวลาทำเกมพัง
      seq += 1;
      try {
        await this.db.appendAction({
          gameId: record.id,
          seq,
          userId: null, // ระบบบังคับ endTurn เอง ไม่ใช่ผู้เล่นคนไหนกดจริง
          factionId,
          turn: state.turn,
          action: { type: 'endTurn' },
        });
      } catch {
        seq -= 1;
        break; // เขียน log ไม่สำเร็จ — หยุดไว้ก่อน เหมือน submit() ปกติ ไม่ขยับ state ต่อ
      }
      state = result.state;
      version += 1;
    }

    const seasonAdvanced = state !== record.state;
    const next: GameRecord = {
      ...record,
      state,
      version,
      seq,
      updatedAt: new Date().toISOString(),
      seasonDeadline: state.ended ? null : new Date(Date.now() + seasonTimerSeconds * 1000).toISOString(),
    };
    await this.store.putGame(next);

    if (seasonAdvanced) {
      void this.db
        .putSnapshot({ gameId: record.id, turn: next.state.turn, version: next.version, state: next.state })
        .catch(() => undefined);
      if (next.state.ended && !record.state.ended) this.recordFinish(next);
      await this.store.publish(record.id, {
        version: next.version,
        seq: next.seq,
        state: next.state,
        events: [],
      });
    }
    return next;
  }
}
