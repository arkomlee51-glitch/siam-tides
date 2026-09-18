import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { tokenFrom } from '../auth.js';
import { rateLimited } from '../errors.js';
import { CreateGameBody, GameParams, SubmitActionBody } from '../schemas.js';

async function guardRate(app: FastifyInstance, key: string): Promise<void> {
  const hit = await app.store.hitRateLimit(key);
  if (!hit.allowed) throw rateLimited(hit.resetSeconds);
}

const clientKey = (request: FastifyRequest) => request.ip || 'unknown';

export async function registerGameRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post('/games', { schema: { body: CreateGameBody } }, async (request, reply) => {
    await guardRate(app, `create:${clientKey(request)}`);
    const created = await app.games.create(request.body);
    request.log.info({ gameId: created.gameId, players: created.players.length }, 'game created');
    return reply.status(201).send(created);
  });

  typed.get('/games/:id', { schema: { params: GameParams } }, async (request) => {
    const { record, factionId } = await app.games.authenticate(request.params.id, tokenFrom(request));
    return app.games.snapshot(record, factionId);
  });

  typed.post(
    '/games/:id/actions',
    { schema: { params: GameParams, body: SubmitActionBody } },
    async (request, reply) => {
      const gameId = request.params.id;
      const { factionId } = await app.games.authenticate(gameId, tokenFrom(request));
      await guardRate(app, `action:${gameId}:${factionId}`);
      const outcome = await app.games.submit({
        gameId,
        factionId,
        action: request.body.action,
        expectedVersion: request.body.expectedVersion,
        idempotencyKey: request.body.idempotencyKey,
      });
      reply.header('x-idempotent-replay', outcome.replayed ? 'true' : 'false');
      return outcome;
    },
  );
}
