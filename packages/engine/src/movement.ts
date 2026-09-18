import { TERRAIN } from './data.js';
import { key, neighbors, parseKey, terrainAt } from './hex.js';
import { armyAt, atWar, cityAt, seasonOf } from './state.js';
import type { Army, GameState } from './types.js';

export interface ReachTile {
  c: number;
  r: number;
  /** movement points left after arriving */
  left: number;
}

function passable(s: GameState, army: Army, c: number, r: number): boolean {
  if (!terrainAt(c, r) || armyAt(s, c, r)) return false;
  const city = cityAt(s, c, r);
  return !city || city.owner === army.owner;
}

/**
 * Tiles a (human) army can move to this season.
 * An army with full movement may always step onto one adjacent tile, even if it costs more than it has.
 */
export function reachableTiles(s: GameState, army: Army): Map<string, ReachTile> {
  const out = new Map<string, ReachTile>();
  if (army.mp <= 0) return out;
  const full = seasonOf(s.turn).move;
  const best = new Map<string, number>([[key(army.c, army.r), army.mp]]);
  const queue: [number, number, number][] = [[army.c, army.r, army.mp]];
  while (queue.length) {
    queue.sort((x, y) => y[2] - x[2]);
    const [c, r, m] = queue.shift()!;
    if ((best.get(key(c, r)) ?? -1) > m) continue;
    for (const [nc, nr] of neighbors(c, r)) {
      if (!passable(s, army, nc, nr)) continue;
      let left = m - TERRAIN[terrainAt(nc, nr)!].cost;
      if (left < 0) {
        const isStart = c === army.c && r === army.r;
        if (isStart && army.mp === full) left = 0;
        else continue;
      }
      const k = key(nc, nr);
      if ((best.get(k) ?? -1) >= left) continue;
      best.set(k, left);
      out.set(k, { c: nc, r: nr, left });
      queue.push([nc, nr, left]);
    }
  }
  return out;
}

/** Adjacent tiles holding an enemy (army or city) this army is at war with. */
export function attackTargets(s: GameState, army: Army): Set<string> {
  const out = new Set<string>();
  if (army.mp <= 0) return out;
  for (const [nc, nr] of neighbors(army.c, army.r)) {
    const enemy = armyAt(s, nc, nr) ?? cityAt(s, nc, nr);
    if (enemy && enemy.owner !== army.owner && atWar(s, army.owner, enemy.owner)) out.add(key(nc, nr));
  }
  return out;
}

/** Cheapest path (excluding start, including goal). Goal may be occupied. */
export function pathTo(s: GameState, army: Army, tc: number, tr: number): [number, number][] | null {
  const start = key(army.c, army.r);
  const goal = key(tc, tr);
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const open: [number, number, number][] = [[0, army.c, army.r]];
  while (open.length) {
    open.sort((x, y) => x[0] - y[0]);
    const [d, c, r] = open.shift()!;
    const k = key(c, r);
    if (k === goal) break;
    if (d > (dist.get(k) ?? Infinity)) continue;
    for (const [nc, nr] of neighbors(c, r)) {
      const t = terrainAt(nc, nr);
      if (!t) continue;
      const nk = key(nc, nr);
      if (nk !== goal && !passable(s, army, nc, nr)) continue;
      const nd = d + TERRAIN[t].cost;
      if ((dist.get(nk) ?? Infinity) <= nd) continue;
      dist.set(nk, nd);
      prev.set(nk, k);
      open.push([nd, nc, nr]);
    }
  }
  if (!prev.has(goal)) return null;
  const path: [number, number][] = [];
  let k = goal;
  while (k !== start) {
    path.unshift(parseKey(k));
    k = prev.get(k)!;
  }
  return path;
}
