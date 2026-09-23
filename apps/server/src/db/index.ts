import type { Config } from '../config.js';
import { createMemoryDb } from './memory.js';
import { createSupabaseDb } from './supabase.js';
import type { Db } from './types.js';

export type { CreateGameInput, Db, DbActionEntry, DbGame, DbSeat, DbSnapshot, ReplayData } from './types.js';
export { createMemoryDb } from './memory.js';
export { createSupabaseDb } from './supabase.js';

export function createDb(config: Config): Db {
  if (config.db === 'memory') return createMemoryDb();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('GAME_DB=supabase ต้องตั้งทั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY');
  }
  return createSupabaseDb({ url: config.supabaseUrl, serviceRoleKey: config.supabaseServiceRoleKey });
}
