import type { FastifyRequest } from 'fastify';

/** เฟส 3 ใช้ player token ที่ออกตอนสร้างเกม เฟส 4 จะเปลี่ยนเป็น Supabase JWT */
export function tokenFrom(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header && /^Bearer /i.test(header)) return header.slice(7).trim() || undefined;
  const custom = request.headers['x-player-token'];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  const query = request.query as { token?: unknown } | undefined;
  if (query && typeof query.token === 'string' && query.token.trim()) return query.token.trim();
  return undefined;
}
