import { z } from 'zod';

const level = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  HOST: z.string().min(1).default('0.0.0.0'),
  /** คั่นหลาย origin ด้วย comma หรือใส่ `*` เพื่อเปิดทั้งหมด */
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** บังคับชนิด store; ถ้าไม่ใส่จะเป็น memory ตอน test และ redis นอกจากนั้น */
  GAME_STORE: z.enum(['redis', 'memory']).optional(),
  LOG_LEVEL: level.optional(),
  /** เกมที่ไม่มีใครแตะจะหมดอายุใน Redis หลังเวลานี้ — โหลดคืนได้จาก Supabase (snapshot + replay) ถ้าหมดอายุ */
  GAME_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  LOCK_TTL_MS: z.coerce.number().int().positive().default(2000),
  LOCK_WAIT_MS: z.coerce.number().int().positive().default(3000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  /** เฟส 5: ห้องรอที่ไม่มีใครแตะจะหมดอายุใน Redis หลังเวลานี้ (ค่าเริ่มต้น 1 ชั่วโมง) */
  LOBBY_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60),

  /* ---------- เฟส 4: Supabase ---------- */
  /** URL โปรเจกต์ เช่น https://xxxx.supabase.co — ใช้คำนวณ JWKS endpoint และเรียก Postgres REST */
  SUPABASE_URL: z.string().url().optional(),
  /** service role (secret) key — server ใช้เขียน DB ข้าม RLS ห้ามส่งให้ client เด็ดขาด */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /**
   * legacy shared secret สำหรับตรวจ JWT แบบ HS256 (โปรเจกต์เก่าที่ยังไม่ได้ย้ายไป JWT signing keys)
   * ถ้าไม่ใส่ server จะตรวจด้วย JWKS ของ SUPABASE_URL แทน (ค่าเริ่มต้นของโปรเจกต์ใหม่ — ไม่ต้องใช้ secret เลย)
   */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  /** บังคับชนิด db; ถ้าไม่ใส่จะเป็น memory ตอน test และ supabase นอกจากนั้น */
  GAME_DB: z.enum(['supabase', 'memory']).optional(),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  corsOrigin: string[] | true;
  redisUrl: string;
  store: 'redis' | 'memory';
  logLevel: z.infer<typeof level>;
  gameTtlSeconds: number;
  idempotencyTtlSeconds: number;
  lockTtlMs: number;
  lockWaitMs: number;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  lobbyTtlSeconds: number;

  db: 'supabase' | 'memory';
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
  supabaseJwtSecret: string | undefined;
  /** `${SUPABASE_URL}/auth/v1` — ต้องตรงกับ claim `iss` ของ JWT */
  supabaseIssuer: string | undefined;
  /** `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` — ใช้ตรวจ JWT แบบ asymmetric (ค่าเริ่มต้น) */
  supabaseJwksUrl: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`ค่าใน environment ไม่ถูกต้อง\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const isTest = e.NODE_ENV === 'test';
  const db = e.GAME_DB ?? (isTest ? 'memory' : 'supabase');

  if (!isTest) {
    if (!e.SUPABASE_URL && !e.SUPABASE_JWT_SECRET) {
      throw new Error(
        'ต้องตั้ง SUPABASE_URL (ตรวจ JWT ด้วย JWKS) หรือ SUPABASE_JWT_SECRET (ตรวจแบบ HS256) อย่างน้อยหนึ่งอย่าง',
      );
    }
    if (db === 'supabase' && (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY)) {
      throw new Error('GAME_DB=supabase ต้องตั้งทั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY');
    }
  }

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    corsOrigin:
      e.CORS_ORIGIN.trim() === '*'
        ? true
        : e.CORS_ORIGIN.split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    redisUrl: e.REDIS_URL,
    store: e.GAME_STORE ?? (isTest ? 'memory' : 'redis'),
    logLevel: e.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
    gameTtlSeconds: e.GAME_TTL_SECONDS,
    idempotencyTtlSeconds: e.IDEMPOTENCY_TTL_SECONDS,
    lockTtlMs: e.LOCK_TTL_MS,
    lockWaitMs: e.LOCK_WAIT_MS,
    rateLimitMax: e.RATE_LIMIT_MAX,
    rateLimitWindowSeconds: e.RATE_LIMIT_WINDOW_SECONDS,
    lobbyTtlSeconds: e.LOBBY_TTL_SECONDS,

    db,
    supabaseUrl: e.SUPABASE_URL,
    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    supabaseJwtSecret: e.SUPABASE_JWT_SECRET,
    supabaseIssuer: e.SUPABASE_URL ? `${e.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1` : undefined,
    supabaseJwksUrl: e.SUPABASE_URL
      ? `${e.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`
      : undefined,
  };
}
