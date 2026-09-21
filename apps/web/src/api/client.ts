import type { Action, GameEvent, GameState } from '@siam/engine';
import { getAccessToken } from './supabase';

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

/** เฟส 4: ผู้เล่นคือ Supabase user เดียว — ไม่มี token ต่อที่นั่งแบบเฟส 3 อีกแล้ว */
export interface Snapshot {
  gameId: string;
  version: number;
  seq: number;
  factionId: string;
  view: GameState;
}
export type CreatedGame = Snapshot;

export interface ActionOutcome extends Snapshot {
  events: GameEvent[];
  replayed: boolean;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { headers, ...rest } = init;
  const token = await getAccessToken();
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

export const createGame = (body: { seed?: number; maxTurn?: number; name?: string }) =>
  request<CreatedGame>('/games', { method: 'POST', body: JSON.stringify(body) });

export const fetchGame = (gameId: string) => request<Snapshot>(`/games/${gameId}`, { method: 'GET' });

export const sendAction = (args: {
  gameId: string;
  action: Action;
  expectedVersion: number;
  idempotencyKey: string;
}) =>
  request<ActionOutcome>(`/games/${args.gameId}/actions`, {
    method: 'POST',
    body: JSON.stringify({
      action: args.action,
      expectedVersion: args.expectedVersion,
      idempotencyKey: args.idempotencyKey,
    }),
  });

/** ต้องดึง token ใหม่ทุกครั้ง (ไม่ใช่แค่ตอนแรก) เพราะ socket.ts เรียกก่อนต่อใหม่ทุกครั้งที่สายหลุดด้วย */
export async function wsUrl(gameId: string): Promise<string> {
  const token = await getAccessToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${API_URL.replace(/^http/, 'ws')}/games/${gameId}/ws${query}`;
}
