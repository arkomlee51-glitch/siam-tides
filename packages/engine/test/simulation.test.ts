import { describe, expect, it } from 'vitest';
import { applyAction, createGame, humanFactions } from '../src/index.js';
import type { EndingId } from '../src/index.js';
import { botSeason, checkInvariants, rng } from './helpers.js';

describe('full-game simulation', () => {
  it('bots finish many single-player games without breaking invariants', () => {
    const endings: Record<string, number> = {};
    for (let seed = 1; seed <= 40; seed++) {
      let s = createGame({ seed });
      const r = rng(seed * 97);
      const style = seed % 2 ? 'war' : 'peace';
      let seasons = 0;
      while (!s.ended && seasons++ < 40) {
        s = botSeason(s, 'p1', r, style);
        checkInvariants(s);
      }
      expect(s.ended).toBe(true);
      const e = s.factions.p1!.ending as EndingId;
      expect(e).toBeTruthy();
      endings[e] = (endings[e] ?? 0) + 1;
    }
    // at least two different endings should be reachable by random play
    expect(Object.keys(endings).length).toBeGreaterThanOrEqual(2);
  });

  it('multiplayer: the season resolves only when every human is ready', () => {
    let s = createGame({ seed: 4, humans: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const r = rng(1);
    s = botSeason(s, 'a', r, 'peace');
    expect(s.turn).toBe(1);
    expect(s.ready).toEqual(['a']);
    const again = applyAction(s, 'a', { type: 'camp', armyId: s.armies.find((x) => x.owner === 'a')!.id });
    expect(again.ok).toBe(false);
    s = botSeason(s, 'b', r, 'war');
    expect(s.turn).toBe(1);
    s = botSeason(s, 'c', r, 'peace');
    expect(s.turn).toBe(2);
    expect(s.ready).toEqual([]);
  });

  it('multiplayer games run to completion', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let s = createGame({ seed, humans: [{ id: 'a' }, { id: 'b' }] });
      const r = rng(seed);
      let guard = 0;
      while (!s.ended && guard++ < 100) {
        for (const f of humanFactions(s)) {
          if (s.ended) break;
          s = botSeason(s, f.id, r, seed % 2 ? 'war' : 'peace');
          checkInvariants(s);
        }
      }
      expect(s.ended).toBe(true);
    }
  });
});
