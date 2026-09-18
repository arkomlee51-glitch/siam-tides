import type { GameEvent, GameState, SeatId } from '@siam/engine';

export interface SeatRecord {
  factionId: string;
  seat: SeatId;
  name: string;
  /** sha256 ของ player token — token จริงถูกส่งคืนครั้งเดียวตอนสร้างเกม */
  tokenHash: string;
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
}
