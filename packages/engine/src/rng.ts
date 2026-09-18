import type { GameState } from './types.js';

/** mulberry32 — tiny, fast, good enough for game dice. State lives in GameState.rng. */
export function random(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randRange = (s: GameState, a: number, b: number): number => a + random(s) * (b - a);
export const chance = (s: GameState, p: number): boolean => random(s) < p;
export function pick<T>(s: GameState, items: readonly T[]): T | undefined {
  if (!items.length) return undefined;
  return items[Math.floor(random(s) * items.length)];
}
