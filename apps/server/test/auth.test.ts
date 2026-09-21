import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { createVerifier } from '../src/auth.js';
import { AppError } from '../src/errors.js';
import { loadConfig } from '../src/config.js';

const SECRET = 'a-test-only-secret-that-is-long-enough-for-hs256';
const key = new TextEncoder().encode(SECRET);

function makeConfig(overrides: Record<string, string> = {}) {
  return loadConfig({ NODE_ENV: 'test', SUPABASE_JWT_SECRET: SECRET, ...overrides } as NodeJS.ProcessEnv);
}

async function sign(
  payload: Record<string, unknown>,
  opts: { exp?: string; aud?: string; secret?: Uint8Array } = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .setAudience(opts.aud ?? 'authenticated')
    .sign(opts.secret ?? key);
}

describe('createVerifier (HS256, shared secret — โปรเจกต์ Supabase เก่า)', () => {
  it('ยอมรับ JWT ที่เซ็นถูกต้องและดึง userId จาก sub', async () => {
    const verifier = createVerifier(makeConfig());
    const token = await sign({ sub: 'user-123', email: 'lee@example.com' });
    const ctx = await verifier.verify(token);
    expect(ctx.userId).toBe('user-123');
    expect(ctx.email).toBe('lee@example.com');
    expect(ctx.isAnonymous).toBe(false);
  });

  it('ตั้ง isAnonymous จาก claim is_anonymous ของ Supabase', async () => {
    const verifier = createVerifier(makeConfig());
    const token = await sign({ sub: 'anon-1', is_anonymous: true });
    const ctx = await verifier.verify(token);
    expect(ctx.isAnonymous).toBe(true);
    expect(ctx.email).toBeNull();
  });

  it('ปฏิเสธ JWT ที่หมดอายุแล้วด้วย 401', async () => {
    const verifier = createVerifier(makeConfig());
    const token = await sign({ sub: 'user-1' }, { exp: '-10s' });
    await expect(verifier.verify(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('ปฏิเสธ JWT ที่เซ็นด้วย secret ผิด', async () => {
    const verifier = createVerifier(makeConfig());
    const wrongKey = new TextEncoder().encode('a-completely-different-secret-value-here');
    const token = await sign({ sub: 'user-1' }, { secret: wrongKey });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AppError);
  });

  it('ปฏิเสธ JWT ที่ audience ไม่ตรง', async () => {
    const verifier = createVerifier(makeConfig());
    const token = await sign({ sub: 'user-1' }, { aud: 'something-else' });
    await expect(verifier.verify(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('ปฏิเสธ JWT ที่ไม่มี sub claim', async () => {
    const verifier = createVerifier(makeConfig());
    const token = await sign({ email: 'no-sub@example.com' });
    await expect(verifier.verify(token)).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('createVerifier — ตั้งค่าไม่ครบ', () => {
  it('โยน error ทันทีถ้าไม่มีทั้ง SUPABASE_URL และ SUPABASE_JWT_SECRET', () => {
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    expect(() => createVerifier(config)).toThrow();
  });
});
