import type { GameEvent, GameState, SeatId } from '@siam/engine';

export interface SeatRecord {
  factionId: string;
  seat: SeatId;
  name: string;
  /** null = ที่นั่ง AI — เฟส 4: ผู้เล่นคือ Supabase user, identity มาจาก JWT ไม่ใช่ token ที่ server ออกเอง */
  userId: string | null;
}

export interface GameRecord {
  id: string;
  /** +1 ทุกคำสั่งที่ถูกใช้จริง — client ส่ง expectedVersion มาเทียบ */
  version: number;
  /** ลำดับคำสั่งที่สำเร็จ (เฟส 4 จะใช้เป็น seq ของ game_actions) */
  seq: number;
  seats: SeatRecord[];
  state: GameState;
  createdAt: string;
  updatedAt: string;
  /** null = ไม่จำกัดเวลาต่อฤดู (ค่าเริ่มต้น) */
  seasonTimerSeconds: number | null;
  /** เวลา (ISO) ที่ฤดูนี้จะถูกบังคับจบถ้ายังมีมนุษย์ไม่ ready — null เมื่อไม่มี seasonTimerSeconds */
  seasonDeadline: string | null;
}

/** สิ่งที่กระจายผ่าน pub/sub ให้ทุก instance ที่มีคนต่อ WebSocket อยู่ */
export interface GameUpdate {
  version: number;
  seq: number;
  state: GameState;
  events: GameEvent[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

/** ที่นั่งในห้องรอ ก่อนเกมจะถูกสร้างจริง — ยังไม่มี factionId/seat ของ engine จนกว่าจะ start */
export interface LobbySeat {
  userId: string;
  name: string;
}

/** เฟส 5: ห้องรอ + รหัสเชิญ — เก็บใน Redis ชั่วคราว (TTL, ดู lobbyTtlSeconds) ไม่ผ่าน Supabase เพราะยังไม่ใช่เกมจริง */
export interface LobbyRecord {
  code: string;
  hostUserId: string;
  seed: number | undefined;
  maxTurn: number | undefined;
  /** เรียงตามลำดับที่เข้าร่วม — index 0 คือ host และจะได้ที่นั่ง p1 เสมอตอน start */
  seats: LobbySeat[];
  /** ตั้งตอน start แล้ว — client ที่ poll เจอค่านี้ให้ไป GET /games/:id ต่อ (ห้องรอเองปล่อยให้หมดอายุไปเอง) */
  startedGameId: string | null;
  createdAt: string;
  /** ส่งต่อให้เกมตอน start — undefined = ไม่จำกัดเวลาต่อฤดู */
  seasonTimerSeconds: number | undefined;
}

export interface Store {
  readonly kind: 'redis' | 'memory';
  getGame(id: string): Promise<GameRecord | null>;
  putGame(record: GameRecord): Promise<void>;
  /** lock ต่อเกม กันคำสั่งสองคำสั่งแก้ state เดียวกันพร้อมกัน */
  withLock<T>(id: string, fn: () => Promise<T>): Promise<T>;
  getIdempotent<T>(gameId: string, key: string): Promise<T | null>;
  setIdempotent(gameId: string, key: string, value: unknown): Promise<void>;
  hitRateLimit(key: string): Promise<RateLimitResult>;
  publish(gameId: string, update: GameUpdate): Promise<void>;
  subscribe(gameId: string, handler: (update: GameUpdate) => void): Promise<() => Promise<void>>;

  getLobby(code: string): Promise<LobbyRecord | null>;
  putLobby(record: LobbyRecord): Promise<void>;
  deleteLobby(code: string): Promise<void>;
  /** lock ต่อห้องรอ กันสองคนกด join/leave/start พร้อมกันแล้วที่นั่งชนกัน */
  withLobbyLock<T>(code: string, fn: () => Promise<T>): Promise<T>;

  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface StoreOptions {
  gameTtlSeconds: number;
  idempotencyTtlSeconds: number;
  lockTtlMs: number;
  lockWaitMs: number;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  lobbyTtlSeconds: number;
}
