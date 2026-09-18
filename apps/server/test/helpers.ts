import type { FastifyInstance } from 'fastify';
import type { Army, GameState } from '@siam/engine';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { PlayerCredentials } from '../src/game/service.js';

export async function makeApp(config: Partial<Config> = {}): Promise<FastifyInstance> {
  return buildApp({
    config: { store: 'memory', logLevel: 'silent', rateLimitMax: 10_000, ...config },
    logger: false,
  });
}

export interface StartedGame {
  gameId: string;
  version: number;
  players: PlayerCredentials[];
  view: GameState;
}

export async function startGame(
  app: FastifyInstance,
  payload: Record<string, unknown> = { seed: 12345 },
): Promise<StartedGame> {
  const res = await app.inject({ method: 'POST', url: '/games', payload });
  if (res.statusCode !== 201) throw new Error(`สร้างเกมไม่สำเร็จ: ${res.statusCode} ${res.body}`);
  return res.json() as StartedGame;
}

export const armyOf = (view: GameState, factionId: string): Army => {
  const army = view.armies.find((a) => a.owner === factionId);
  if (!army) throw new Error(`ไม่พบทัพของ ${factionId}`);
  return army;
};

let keySeq = 0;
export const idemKey = (label = 'k') => `${label}-${++keySeq}-${'x'.repeat(8)}`;

export function submit(
  app: FastifyInstance,
  game: { gameId: string },
  token: string,
  body: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: `/games/${game.gameId}/actions`,
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
}
