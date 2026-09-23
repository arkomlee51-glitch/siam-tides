import type { CreateGameInput, Db, DbActionEntry, DbGame, DbSeat, DbSnapshot, ReplayData } from './types.js';

/**
 * Db ในหน่วยความจำสำหรับ test และการพัฒนาที่ไม่ได้ต่อ Supabase จริง
 * พฤติกรรมที่เห็นจากข้างนอกต้องเหมือน supabase.ts (รวมถึง clone ตอนอ่าน/เขียน)
 */
export function createMemoryDb(): Db {
  const games = new Map<string, DbGame>();
  const seats = new Map<string, DbSeat[]>();
  const actions = new Map<string, DbActionEntry[]>();
  const snapshots = new Map<string, DbSnapshot[]>();

  return {
    kind: 'memory',

    async createGame(input: CreateGameInput) {
      const now = new Date().toISOString();
      games.set(input.id, {
        id: input.id,
        status: 'active',
        seed: input.seed ?? null,
        engineVersion: input.engineVersion,
        maxTurn: input.maxTurn ?? null,
        chapterId: input.chapterId,
        seasonTimerSeconds: input.seasonTimerSeconds ?? null,
        createdBy: input.createdBy,
        createdAt: now,
        finishedAt: null,
      });
      seats.set(input.id, structuredClone(input.seats));
      actions.set(input.id, []);
      snapshots.set(input.id, []);
    },

    async appendAction(entry: DbActionEntry) {
      const list = actions.get(entry.gameId);
      if (!list) return; // เกมไม่มีอยู่จริง (ไม่ควรเกิด) — เงียบไว้เหมือน best-effort log
      list.push(structuredClone(entry));
    },

    async putSnapshot(snapshot: DbSnapshot) {
      const list = snapshots.get(snapshot.gameId);
      if (!list) return;
      const idx = list.findIndex((s) => s.turn === snapshot.turn);
      const copy = structuredClone(snapshot);
      if (idx === -1) list.push(copy);
      else list[idx] = copy;
    },

    async loadForReplay(gameId: string): Promise<ReplayData | null> {
      const game = games.get(gameId);
      if (!game) return null;
      const gameSeats = seats.get(gameId) ?? [];
      const snaps = snapshots.get(gameId) ?? [];
      const latest = snaps.reduce<DbSnapshot | null>(
        (best, s) => (!best || s.turn > best.turn ? s : best),
        null,
      );
      const all = actions.get(gameId) ?? [];
      const since = all
        .filter((a) => a.seq > (latest?.version ?? 0))
        .slice()
        .sort((a, b) => a.seq - b.seq);
      return {
        game: structuredClone(game),
        seats: structuredClone(gameSeats),
        snapshot: latest ? structuredClone(latest) : null,
        actionsSinceSnapshot: structuredClone(since),
      };
    },

    async markFinished(gameId: string, endingByFactionId: Record<string, string>) {
      const game = games.get(gameId);
      if (game) {
        game.status = 'finished';
        game.finishedAt = new Date().toISOString();
      }
      const gameSeats = seats.get(gameId);
      if (gameSeats) {
        for (const seat of gameSeats) {
          const ending = endingByFactionId[seat.factionId];
          if (ending) seat.ending = ending;
        }
      }
    },

    async close() {
      games.clear();
      seats.clear();
      actions.clear();
      snapshots.clear();
    },
  };
}
