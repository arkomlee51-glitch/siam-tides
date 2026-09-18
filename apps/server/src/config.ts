export interface Config {
  port: number;
  host: string;
  corsOrigin: string;
  redisUrl: string;
}

/** Phase 3 replaces this with a zod-validated schema. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  };
}
