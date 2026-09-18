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
  /** เกมที่ไม่มีใครแตะจะหมดอายุใน Redis หลังเวลานี้ (เฟส 4 จะมี Postgres รองรับ) */
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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`ค่าใน environment ไม่ถูกต้อง\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const isTest = e.NODE_ENV === 'test';
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
  };
}
