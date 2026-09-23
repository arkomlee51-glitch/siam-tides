import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { tokenFrom } from '../auth.js';
import { rateLimited, unauthorized } from '../errors.js';
import { CreateLobbyBody, JoinLobbyBody, LobbyParams } from '../schemas.js';

async function guardRate(app: FastifyInstance, key: string): Promise<void> {
  const hit = await app.store.hitRateLimit(key);
  if (!hit.allowed) throw rateLimited(hit.resetSeconds);
}

const clientKey = (request: FastifyRequest) => request.ip || 'unknown';

/** เฟส 5: ห้องรอ + รหัสเชิญ — สร้าง/เข้าร่วม/ออก/เริ่มเกม (ดู game/lobby.ts) */
export async function registerLobbyRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post('/lobbies', { schema: { body: CreateLobbyBody } }, async (request, reply) => {
    const token = tokenFrom(request);
    if (!token) throw unauthorized();
    const auth = await app.auth.verify(token);
    await guardRate(app, `create-lobby:${clientKey(request)}`);
    const displayName = request.body.name?.trim() || auth.email || 'ผู้เล่น';
    const lobby = await app.lobbies.create(
      auth.userId,
      displayName,
      request.body.seed,
      request.body.maxTurn,
      request.body.seasonTimerSeconds,
      request.body.chapterId,
    );
    return reply.status(201).send(lobby);
  });

  typed.get('/lobbies/:code', { schema: { params: LobbyParams } }, async (request) => {
    const token = tokenFrom(request);
    if (!token) throw unauthorized();
    await app.auth.verify(token);
    return app.lobbies.get(request.params.code);
  });

  typed.post(
    '/lobbies/:code/join',
    { schema: { params: LobbyParams, body: JoinLobbyBody } },
    async (request) => {
      const token = tokenFrom(request);
      if (!token) throw unauthorized();
      const auth = await app.auth.verify(token);
      // รหัส 6 หลักเดาได้ในทางทฤษฎี จำกัดอัตราการลองต่อ IP ไว้กันเดาสุ่ม
      await guardRate(app, `join-lobby:${clientKey(request)}`);
      const displayName = request.body.name?.trim() || auth.email || undefined;
      return app.lobbies.join(request.params.code, auth.userId, displayName);
    },
  );

  typed.post('/lobbies/:code/leave', { schema: { params: LobbyParams } }, async (request, reply) => {
    const token = tokenFrom(request);
    if (!token) throw unauthorized();
    const auth = await app.auth.verify(token);
    await app.lobbies.leave(request.params.code, auth.userId);
    return reply.status(204).send();
  });

  typed.post('/lobbies/:code/start', { schema: { params: LobbyParams } }, async (request, reply) => {
    const token = tokenFrom(request);
    if (!token) throw unauthorized();
    const auth = await app.auth.verify(token);
    const created = await app.lobbies.start(request.params.code, auth.userId);
    request.log.info({ gameId: created.gameId, code: request.params.code }, 'game started from lobby');
    return reply.status(201).send(created);
  });
}
