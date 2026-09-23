import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action, GameState, LegacyBonus, LegacyCategory, SeatId } from '@siam/engine';
import type {
  CreateGameInput,
  Db,
  DbActionEntry,
  DbGame,
  DbSeat,
  DbSnapshot,
  LegacyRecord,
  ReplayData,
} from './types.js';

interface GameRow {
  id: string;
  status: 'lobby' | 'active' | 'finished';
  seed: number | null;
  engine_version: string;
  max_turn: number | null;
  chapter_id: string | null;
  season_timer_seconds: number | null;
  created_by: string;
  created_at: string;
  finished_at: string | null;
}

interface GamePlayerRow {
  game_id: string;
  user_id: string | null;
  faction_id: string;
  seat: SeatId;
  name: string;
  ending: string | null;
  legacy: Partial<Record<LegacyCategory, number>> | null;
}

interface PlayerLegacyRow {
  user_id: string;
  chapter_id: string;
  bonuses: LegacyBonus[];
  source_game_id: string | null;
  computed_at: string;
}

interface GameSnapshotRow {
  game_id: string;
  turn: number;
  version: number;
  state: GameState;
}

interface GameActionRow {
  game_id: string;
  seq: number;
  user_id: string | null;
  faction_id: string;
  turn: number;
  action: Action;
}

const toDbGame = (row: GameRow): DbGame => ({
  id: row.id,
  status: row.status,
  seed: row.seed,
  engineVersion: row.engine_version,
  maxTurn: row.max_turn,
  chapterId: row.chapter_id ?? null,
  seasonTimerSeconds: row.season_timer_seconds ?? null,
  createdBy: row.created_by,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
});

const toDbSeat = (row: GamePlayerRow): DbSeat => ({
  factionId: row.faction_id,
  seat: row.seat,
  name: row.name,
  userId: row.user_id,
  ending: row.ending,
  legacy: row.legacy ?? null,
});

const toDbSnapshot = (row: GameSnapshotRow): DbSnapshot => ({
  gameId: row.game_id,
  turn: row.turn,
  version: row.version,
  state: row.state,
});

const toDbAction = (row: GameActionRow): DbActionEntry => ({
  gameId: row.game_id,
  seq: row.seq,
  userId: row.user_id,
  factionId: row.faction_id,
  turn: row.turn,
  action: row.action,
});

export interface SupabaseDbOptions {
  url: string;
  serviceRoleKey: string;
}

/** เขียน/อ่าน Postgres ของ Supabase ด้วย service role — ข้าม RLS ได้ (ผู้เล่นอ่านตรงผ่าน RLS เอง ไม่ผ่าน server) */
export function createSupabaseDb(opts: SupabaseDbOptions): Db {
  const client: SupabaseClient = createClient(opts.url, opts.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    kind: 'supabase',

    async createGame(input: CreateGameInput) {
      const { error: gameErr } = await client.from('games').insert({
        id: input.id,
        status: 'active',
        seed: input.seed ?? null,
        engine_version: input.engineVersion,
        max_turn: input.maxTurn ?? null,
        chapter_id: input.chapterId,
        season_timer_seconds: input.seasonTimerSeconds ?? null,
        created_by: input.createdBy,
      });
      if (gameErr) throw new Error(`บันทึกเกมลง Supabase ไม่สำเร็จ: ${gameErr.message}`);

      const rows = input.seats.map((s): Omit<GamePlayerRow, 'ending'> & { ending?: string | null } => ({
        game_id: input.id,
        user_id: s.userId,
        faction_id: s.factionId,
        seat: s.seat,
        name: s.name,
        ending: s.ending,
        legacy: s.legacy ?? null,
      }));
      const { error: playersErr } = await client.from('game_players').insert(rows);
      if (playersErr) throw new Error(`บันทึกที่นั่งผู้เล่นลง Supabase ไม่สำเร็จ: ${playersErr.message}`);
    },

    async appendAction(entry: DbActionEntry) {
      const { error } = await client.from('game_actions').insert({
        game_id: entry.gameId,
        seq: entry.seq,
        user_id: entry.userId,
        faction_id: entry.factionId,
        turn: entry.turn,
        action: entry.action,
      });
      if (error) throw new Error(`บันทึก action log ลง Supabase ไม่สำเร็จ: ${error.message}`);
    },

    async putSnapshot(snapshot: DbSnapshot) {
      const { error } = await client.from('game_snapshots').upsert(
        {
          game_id: snapshot.gameId,
          turn: snapshot.turn,
          version: snapshot.version,
          state: snapshot.state,
        },
        { onConflict: 'game_id,turn' },
      );
      if (error) throw new Error(`บันทึก snapshot ลง Supabase ไม่สำเร็จ: ${error.message}`);
    },

    async loadForReplay(gameId: string): Promise<ReplayData | null> {
      const { data: gameRow, error: gameErr } = await client
        .from('games')
        .select('*')
        .eq('id', gameId)
        .maybeSingle();
      if (gameErr) throw new Error(`โหลดเกมจาก Supabase ไม่สำเร็จ: ${gameErr.message}`);
      if (!gameRow) return null;
      const game = toDbGame(gameRow as GameRow);

      const { data: seatRows, error: seatErr } = await client
        .from('game_players')
        .select('*')
        .eq('game_id', gameId);
      if (seatErr) throw new Error(`โหลดที่นั่งผู้เล่นจาก Supabase ไม่สำเร็จ: ${seatErr.message}`);
      const seats = ((seatRows as GamePlayerRow[] | null) ?? []).map(toDbSeat);

      const { data: snapRow, error: snapErr } = await client
        .from('game_snapshots')
        .select('*')
        .eq('game_id', gameId)
        .order('turn', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (snapErr) throw new Error(`โหลด snapshot จาก Supabase ไม่สำเร็จ: ${snapErr.message}`);
      const snapshot = snapRow ? toDbSnapshot(snapRow as GameSnapshotRow) : null;

      const { data: actionRows, error: actionErr } = await client
        .from('game_actions')
        .select('*')
        .eq('game_id', gameId)
        .gt('seq', snapshot?.version ?? 0)
        .order('seq', { ascending: true });
      if (actionErr) throw new Error(`โหลด action log จาก Supabase ไม่สำเร็จ: ${actionErr.message}`);
      const actionsSinceSnapshot = ((actionRows as GameActionRow[] | null) ?? []).map(toDbAction);

      return { game, seats, snapshot, actionsSinceSnapshot };
    },

    async markFinished(gameId: string, endingByFactionId: Record<string, string>) {
      await client
        .from('games')
        .update({ status: 'finished', finished_at: new Date().toISOString() })
        .eq('id', gameId);
      for (const [factionId, ending] of Object.entries(endingByFactionId)) {
        await client
          .from('game_players')
          .update({ ending })
          .eq('game_id', gameId)
          .eq('faction_id', factionId);
      }
    },

    async upsertLegacy(records: Omit<LegacyRecord, 'computedAt'>[]) {
      if (records.length === 0) return;
      const now = new Date().toISOString();
      const { error } = await client.from('player_legacy').upsert(
        records.map((r): PlayerLegacyRow => ({
          user_id: r.userId,
          chapter_id: r.chapterId,
          bonuses: r.bonuses,
          source_game_id: r.sourceGameId,
          computed_at: now,
        })),
        { onConflict: 'user_id,chapter_id' },
      );
      if (error) throw new Error(`บันทึก Legacy ลง Supabase ไม่สำเร็จ: ${error.message}`);
    },

    async loadLatestLegacy(userIds: string[]) {
      const out = new Map<string, LegacyRecord>();
      if (userIds.length === 0) return out;
      const { data, error } = await client
        .from('player_legacy')
        .select('*')
        .in('user_id', userIds)
        .order('computed_at', { ascending: false });
      if (error) throw new Error(`โหลด Legacy จาก Supabase ไม่สำเร็จ: ${error.message}`);
      // เรียงใหม่สุดก่อน — แถวแรกที่เจอของผู้เล่นแต่ละคนคือบทล่าสุดที่เล่นจบ
      for (const row of (data as PlayerLegacyRow[] | null) ?? []) {
        if (out.has(row.user_id)) continue;
        out.set(row.user_id, {
          userId: row.user_id,
          chapterId: row.chapter_id,
          bonuses: row.bonuses,
          sourceGameId: row.source_game_id,
          computedAt: row.computed_at,
        });
      }
      return out;
    },

    async close() {
      /* supabase-js เป็น REST client ไม่มี connection ให้ปิด */
    },
  };
}
