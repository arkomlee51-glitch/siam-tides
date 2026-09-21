import { lobbyForbidden, lobbyFull, lobbyNotFound, lobbyStarted } from '../errors.js';
import type { LobbyRecord, Store } from '../store/index.js';
import type { CreatedGame, GameService } from './service.js';

const MAX_SEATS = 4;
/** ตัดตัวที่อ่านสับสน: 0/O, 1/I/L */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export interface LobbySeatView {
  userId: string;
  name: string;
}

export interface LobbyView {
  code: string;
  hostUserId: string;
  seed: number | undefined;
  maxTurn: number | undefined;
  seats: LobbySeatView[];
  /** ตั้งแล้ว = เกมเริ่มไปแล้ว — client ที่ poll เจอค่านี้ให้ไป GET /games/:id ด้วย token ตัวเอง */
  startedGameId: string | null;
  /** undefined = ไม่จำกัดเวลาต่อฤดูเมื่อเกมเริ่ม */
  seasonTimerSeconds: number | undefined;
}

const toView = (record: LobbyRecord): LobbyView => ({
  code: record.code,
  hostUserId: record.hostUserId,
  seed: record.seed,
  maxTurn: record.maxTurn,
  seats: record.seats,
  startedGameId: record.startedGameId,
  seasonTimerSeconds: record.seasonTimerSeconds,
});

/**
 * เฟส 5: ห้องรอ + รหัสเชิญ ก่อนเกมจะถูกสร้างจริง
 * เก็บใน Store (Redis/memory) เท่านั้น ไม่ผ่าน Supabase เพราะยังไม่ใช่เกม — เกมจริงถูกสร้างตอน start()
 * ผ่าน GameService.createFromLobby (เขียน Supabase + Redis เหมือน POST /games ปกติทุกอย่าง)
 */
export class LobbyService {
  constructor(
    private readonly store: Store,
    private readonly games: GameService,
  ) {}

  async create(
    hostUserId: string,
    hostName: string,
    seed: number | undefined,
    maxTurn: number | undefined,
    seasonTimerSeconds: number | undefined,
  ): Promise<LobbyView> {
    let code = randomCode();
    // กันโค้ดชนกัน (โอกาสน้อยมากกับ 32^6 ตัวเลือก แต่กันไว้ไม่เสียหาย)
    for (let tries = 0; tries < 5 && (await this.store.getLobby(code)) !== null; tries++) {
      code = randomCode();
    }
    const record: LobbyRecord = {
      code,
      hostUserId,
      seed,
      maxTurn,
      seats: [{ userId: hostUserId, name: hostName }],
      startedGameId: null,
      createdAt: new Date().toISOString(),
      seasonTimerSeconds,
    };
    await this.store.putLobby(record);
    return toView(record);
  }

  async get(code: string): Promise<LobbyView> {
    const record = await this.store.getLobby(code);
    if (!record) throw lobbyNotFound();
    return toView(record);
  }

  /** เข้าร่วมห้อง — ถ้าเป็นสมาชิกอยู่แล้วถือว่าสำเร็จเลย (idempotent กัน retry ซ้ำจากเครือข่ายไม่นิ่ง) */
  async join(code: string, userId: string, name: string | undefined): Promise<LobbyView> {
    return this.store.withLobbyLock(code, async () => {
      const record = await this.store.getLobby(code);
      if (!record) throw lobbyNotFound();
      if (record.startedGameId) throw lobbyStarted(record.startedGameId);
      const existing = record.seats.find((s) => s.userId === userId);
      if (existing) {
        if (name?.trim()) existing.name = name.trim();
        await this.store.putLobby(record);
        return toView(record);
      }
      if (record.seats.length >= MAX_SEATS) throw lobbyFull();
      record.seats.push({ userId, name: name?.trim() || `ผู้เล่น ${record.seats.length + 1}` });
      await this.store.putLobby(record);
      return toView(record);
    });
  }

  /** ออกจากห้อง — host ออก = ยกเลิกห้องทั้งหมด (ยังไม่ทำระบบโอน host ให้คนอื่นในเฟสนี้) */
  async leave(code: string, userId: string): Promise<void> {
    await this.store.withLobbyLock(code, async () => {
      const record = await this.store.getLobby(code);
      if (!record || record.startedGameId) return;
      if (record.hostUserId === userId) {
        await this.store.deleteLobby(code);
        return;
      }
      record.seats = record.seats.filter((s) => s.userId !== userId);
      await this.store.putLobby(record);
    });
  }

  /** host เท่านั้นที่เริ่มเกมได้ — ที่นั่งตอนนี้ (host อยู่ index 0 เสมอ) กลายเป็นที่นั่งมนุษย์ p1..pN ของเกมจริง */
  async start(code: string, hostUserId: string): Promise<CreatedGame> {
    return this.store.withLobbyLock(code, async () => {
      const record = await this.store.getLobby(code);
      if (!record) throw lobbyNotFound();
      if (record.startedGameId) throw lobbyStarted(record.startedGameId);
      if (record.hostUserId !== hostUserId) throw lobbyForbidden();
      const created = await this.games.createFromLobby(
        record.seats,
        record.seed,
        record.maxTurn,
        record.seasonTimerSeconds,
      );
      record.startedGameId = created.gameId;
      await this.store.putLobby(record);
      return created;
    });
  }
}
