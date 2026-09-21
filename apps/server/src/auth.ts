import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import { unauthorized } from './errors.js';

/**
 * เฟส 4: ผู้เล่นคือ Supabase user — `userId` คือ `sub` ของ JWT (ดู ADR-0004)
 * `isAnonymous`/`email` เอาไว้ให้ web แสดงผลเท่านั้น server ไม่ตัดสินสิทธิ์จากสองฟิลด์นี้
 */
export interface AuthContext {
  userId: string;
  isAnonymous: boolean;
  email: string | null;
  claims: JWTPayload;
}

export interface Verifier {
  verify(token: string): Promise<AuthContext>;
}

function toAuthContext(payload: JWTPayload): AuthContext {
  if (typeof payload.sub !== 'string' || !payload.sub) throw unauthorized('token ไม่มี user id');
  return {
    userId: payload.sub,
    isAnonymous: payload['is_anonymous'] === true,
    email: typeof payload.email === 'string' ? payload.email : null,
    claims: payload,
  };
}

/**
 * ตรวจ JWT ที่ Supabase ออกให้ — รองรับสองแบบ:
 *  - โปรเจกต์ใหม่ (ค่าเริ่มต้น): เซ็นด้วยกุญแจ asymmetric ตรวจผ่าน JWKS ของ `SUPABASE_URL`
 *    ไม่ต้องมี secret ฝั่ง server เลย (`jose` แคช/หมุนกุญแจให้เอง)
 *  - โปรเจกต์เก่าที่ยังใช้ legacy shared secret: ตั้ง `SUPABASE_JWT_SECRET` เพื่อตรวจแบบ HS256 แทน
 *    (เร็วกว่าเพราะไม่ต้องออกเน็ต แต่ใช้ได้เฉพาะโปรเจกต์ที่ยังไม่ย้ายไป JWT signing keys)
 */
export function createVerifier(config: Config): Verifier {
  const issuer = config.supabaseIssuer;
  const audience = 'authenticated';

  if (config.supabaseJwtSecret) {
    const secret = new TextEncoder().encode(config.supabaseJwtSecret);
    return {
      async verify(token) {
        try {
          const { payload } = await jwtVerify(token, secret, { issuer, audience });
          return toAuthContext(payload);
        } catch {
          throw unauthorized('token ไม่ถูกต้องหรือหมดอายุ');
        }
      },
    };
  }

  if (config.supabaseJwksUrl) {
    const jwks = createRemoteJWKSet(new URL(config.supabaseJwksUrl));
    return {
      async verify(token) {
        try {
          const { payload } = await jwtVerify(token, jwks, { issuer, audience });
          return toAuthContext(payload);
        } catch {
          throw unauthorized('token ไม่ถูกต้องหรือหมดอายุ');
        }
      },
    };
  }

  throw new Error('ไม่ได้ตั้งค่า Supabase สำหรับตรวจ JWT (ต้องมี SUPABASE_URL หรือ SUPABASE_JWT_SECRET)');
}

/** raw token จาก request — header มาตรฐาน, header เดิมของเฟส 3 (เผื่อ client เก่าค้างอยู่) หรือ query (WebSocket ตั้ง header เองไม่ได้) */
export function tokenFrom(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header && /^Bearer /i.test(header)) return header.slice(7).trim() || undefined;
  const custom = request.headers['x-player-token'];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  const query = request.query as { token?: unknown } | undefined;
  if (query && typeof query.token === 'string' && query.token.trim()) return query.token.trim();
  return undefined;
}
