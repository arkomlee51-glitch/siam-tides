import type { Action, GameState, LegacyBonus, LegacyCategory, SeatId } from '@siam/engine';

export interface DbSeat {
  factionId: string;
  seat: SeatId;
  name: string;
  /** null = ที่นั่ง AI — ไม่มี Supabase user ผูกอยู่ */
  userId: string | null;
  ending: string | null;
  /** Legacy รวมที่ที่นั่งนี้ได้ตอนเริ่มเกม — replay ใช้ค่านี้ (ไม่มี/null = ไม่มี Legacy) */
  legacy?: Partial<Record<LegacyCategory, number>> | null;
}

/** 1 แถวของ player_legacy — Legacy ที่ผู้เล่นได้จากการจบบทหนึ่ง (บทเดิมเล่นซ้ำ = ทับแถวเดิม) */
export interface LegacyRecord {
  userId: string;
  chapterId: string;
  bonuses: LegacyBonus[];
  sourceGameId: string | null;
  /** ISO — ใช้ตัดสินว่าแถวไหนคือ "บทล่าสุดที่เล่นจบ" */
  computedAt: string;
}

export interface DbGame {
  id: string;
  status: 'lobby' | 'active' | 'finished';
  seed: number | null;
  engineVersion: string;
  maxTurn: number | null;
  /** `ChapterDefinition.manifest.id` — null = เกมที่สร้างก่อนเฟส 6 (บทเดียวที่ชิป) */
  chapterId: string | null;
  /** วินาทีต่อฤดู — null = ไม่จำกัดเวลา */
  seasonTimerSeconds: number | null;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface DbSnapshot {
  gameId: string;
  turn: number;
  /** version ของ GameRecord ตอนที่ถ่าย snapshot — action ที่ seq สูงกว่านี้เท่านั้นที่ต้อง replay ต่อ */
  version: number;
  state: GameState;
}

export interface DbActionEntry {
  gameId: string;
  seq: number;
  userId: string | null;
  factionId: string;
  turn: number;
  action: Action;
}

export interface CreateGameInput {
  id: string;
  engineVersion: string;
  seed: number | undefined;
  maxTurn: number | undefined;
  chapterId: string;
  seasonTimerSeconds: number | undefined;
  createdBy: string;
  seats: DbSeat[];
}

export interface ReplayData {
  game: DbGame;
  seats: DbSeat[];
  /** snapshot ล่าสุด (null ถ้ายังไม่เคยถ่าย — ต้องเริ่ม replay จาก genesis ด้วย seed เดิม) */
  snapshot: DbSnapshot | null;
  /** action ทั้งหมดที่ seq มากกว่า snapshot.version เรียงจากน้อยไปมาก */
  actionsSinceSnapshot: DbActionEntry[];
}

/**
 * ข้อมูลถาวรของเฟส 4 — คู่กับ Store (Redis/memory) ที่เก็บ state ร้อน
 * SupabaseDb ใช้ service role client จริง, MemoryDb ใช้ในเทสต์ (ไม่ต้องมี network)
 */
export interface Db {
  readonly kind: 'supabase' | 'memory';
  createGame(input: CreateGameInput): Promise<void>;
  appendAction(entry: DbActionEntry): Promise<void>;
  putSnapshot(snapshot: DbSnapshot): Promise<void>;
  /** null = ไม่พบเกมนี้เลยใน Postgres (ยังไม่เคยสร้าง หรือ id ผิด) */
  loadForReplay(gameId: string): Promise<ReplayData | null>;
  /** best-effort — เรียกตอนเกมจบ (state.ended) ไม่ block response ถ้าล้มเหลว */
  markFinished(gameId: string, endingByFactionId: Record<string, string>): Promise<void>;
  /** เขียน/ทับ Legacy ของผู้เล่นต่อบท (upsert ตาม user_id + chapter_id) */
  upsertLegacy(records: Omit<LegacyRecord, 'computedAt'>[]): Promise<void>;
  /** Legacy จากบทที่ผู้เล่นแต่ละคนเล่นจบล่าสุด (computedAt ใหม่สุด) — คนที่ไม่มีจะไม่อยู่ใน Map */
  loadLatestLegacy(userIds: string[]): Promise<Map<string, LegacyRecord>>;
  close(): Promise<void>;
}
