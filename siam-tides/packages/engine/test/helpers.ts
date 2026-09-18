import { expect } from 'vitest';
import {
  BUILDING_IDS,
  applyAction,
  armiesOf,
  attackTargets,
  citiesOf,
  describeDecision,
  isLand,
  key,
  parseKey,
  reachableTiles,
} from '../src/index.js';
import type { Action, FactionId, GameState } from '../src/index.js';

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function act(s: GameState, fid: FactionId, action: Action): GameState {
  const r = applyAction(s, fid, action);
  if (!r.ok) throw new Error(`${action.type} failed: ${r.error}`);
  return r.state;
}

/** Try an action; keep the old state if it's rejected. */
export function tryAct(s: GameState, fid: FactionId, action: Action): GameState {
  const r = applyAction(s, fid, action);
  return r.ok ? r.state : s;
}

export function checkInvariants(s: GameState): void {
  const seen = new Set<string>();
  for (const a of s.armies) {
    const k = key(a.c, a.r);
    expect(seen.has(k), `two armies on ${k}`).toBe(false);
    seen.add(k);
    expect(isLand(a.c, a.r), `army on water ${k}`).toBe(true);
    expect(a.str).toBeGreaterThanOrEqual(6);
    expect(s.factions[a.owner]?.alive, `army of dead faction ${a.owner}`).toBe(true);
    const city = s.cities.find((c) => c.c === a.c && c.r === a.r);
    if (city) expect(city.owner).toBe(a.owner);
  }
  const cityTiles = new Set<string>();
  for (const c of s.cities) {
    expect(isLand(c.c, c.r)).toBe(true);
    expect(cityTiles.has(key(c.c, c.r))).toBe(false);
    cityTiles.add(key(c.c, c.r));
  }
  for (const f of Object.values(s.factions)) {
    if (f.kind !== 'human') continue;
    for (const v of Object.values(f.res)) expect(v).toBeGreaterThanOrEqual(0);
    expect(f.stability).toBeGreaterThanOrEqual(0);
    expect(f.stability).toBeLessThanOrEqual(100);
    expect(Math.abs(f.meter)).toBeLessThanOrEqual(100);
    const caps = citiesOf(s, f.id).filter((c) => c.capital);
    if (f.alive) expect(caps.length).toBe(1);
  }
}

export type BotStyle = 'peace' | 'war';

/** A dumb but legal player. Plays one full season for `fid`. */
export function botSeason(s: GameState, fid: FactionId, r: () => number, style: BotStyle): GameState {
  const pickOne = <T>(xs: T[]): T | undefined => xs[Math.floor(r() * xs.length)];
  let guard = 0;
  while (s.pending.some((p) => p.faction === fid) && guard++ < 5) {
    const d = s.pending.find((p) => p.faction === fid)!;
    const info = describeDecision(s, d);
    const opt = pickOne(info.options.filter((o) => o.enabled))!;
    s = act(s, fid, { type: 'answerDecision', decisionId: d.id, choice: opt.choice });
  }
  if (s.ended || !s.factions[fid]!.alive) return s;

  for (const city of citiesOf(s, fid)) {
    const b = pickOne([...BUILDING_IDS]);
    if (b) s = tryAct(s, fid, { type: 'build', cityId: city.id, building: b });
    if (r() < 0.3) s = tryAct(s, fid, { type: 'recruit', cityId: city.id });
  }
  const capital = citiesOf(s, fid).find((c) => c.capital);
  for (const army of armiesOf(s, fid)) {
    if (s.ended || !s.factions[fid]!.alive) return s;
    const a = s.armies.find((x) => x.id === army.id);
    if (!a) continue;
    const targets = [...attackTargets(s, a)];
    if (targets.length) {
      const [c, rr] = parseKey(targets[0]!);
      s = act(s, fid, { type: 'attack', armyId: a.id, c, r: rr });
      continue;
    }
    // keep one army home in war style
    if (
      style === 'war' &&
      capital &&
      a.c === capital.c &&
      a.r === capital.r &&
      armiesOf(s, fid).length === 1 &&
      r() < 0.7
    )
      continue;
    const dest = pickOne([...reachableTiles(s, a).values()]);
    if (dest) s = act(s, fid, { type: 'move', armyId: a.id, c: dest.c, r: dest.r });
    if (r() < 0.25) s = tryAct(s, fid, { type: 'found', armyId: a.id });
    if (r() < 0.1) s = tryAct(s, fid, { type: 'camp', armyId: a.id });
  }
  const ais = Object.values(s.factions).filter((f) => f.kind === 'ai' && f.alive);
  if (style === 'war' && s.turn === 2) s = tryAct(s, fid, { type: 'declareWar', target: 'south' });
  for (const ai of ais) {
    s = tryAct(s, fid, { type: r() < 0.5 ? 'tribute' : 'festival', target: ai.id });
    s = tryAct(s, fid, { type: 'annex', target: ai.id });
    if (r() < 0.05) s = tryAct(s, fid, { type: 'offerPeace', target: ai.id });
  }
  s = tryAct(s, fid, { type: 'envoy', power: s.turn % 2 ? 'lion' : 'eagle' });
  return act(s, fid, { type: 'endTurn' });
}
