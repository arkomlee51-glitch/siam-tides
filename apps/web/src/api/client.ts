import type { Action, GameEvent, GameState } from '@siam/engine';

const raw = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
export const API_URL = raw.replace(/\/+$/, '');

export interface ErrorBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface PlayerCredentials {
  factionId: string;
  seat: string;
  name: string;
  token: string;
}

export interface CreatedGame {
  gameId: string;
  version: number;
  seq: number;
  players: PlayerCredentials[];
  view: GameState;
}

export interface Snapshot {
  gameId: string;
  version: number;
  seq: number;
  factionId: string;
  view: GameState;
}

export interface ActionOutcome extends Snapshot {
  events: GameEvent[];
  replayed: boolean;
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (body ?? {}) as Partial<ErrorBody>;
    throw new ApiError(
      res.status,
      err.error ?? 'HTTP_ERROR',
      err.message ?? `คำขอไม่สำเร็จ (${res.status})`,
      err.details,
    );
  }
  return body as T;
}

export const createGame = (body: { seed?: number; maxTurn?: number; players?: { name?: string }[] }) =>
  request<CreatedGame>('/games', { method: 'POST', body: JSON.stringify(body) });

export const fetchGame = (gameId: string, token: string) =>
  request<Snapshot>(`/games/${gameId}`, { method: 'GET', token });

export const sendAction = (args: {
  gameId: string;
  token: string;
  action: Action;
  expectedVersion: number;
  idempotencyKey: string;
}) =>
  request<ActionOutcome>(`/games/${args.gameId}/actions`, {
    method: 'POST',
    token: args.token,
    body: JSON.stringify({
      action: args.action,
      expectedVersion: args.expectedVersion,
      idempotencyKey: args.idempotencyKey,
    }),
  });

export const wsUrl = (gameId: string, token: string) =>
  `${API_URL.replace(/^http/, 'ws')}/games/${gameId}/ws?token=${encodeURIComponent(token)}`;
