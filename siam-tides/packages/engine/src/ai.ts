import { RULES, TERRAIN } from './data.js';
import { resolveBattle } from './combat.js';
import { hexDistance, neighbors, terrainAt } from './hex.js';
import { pathTo } from './movement.js';
import {
  aiFactions,
  armiesOf,
  armyAt,
  atWar,
  capitalOf,
  cityAt,
  faction,
  humanFactions,
  newId,
  seasonOf,
} from './state.js';
import type { Ctx } from './state.js';
import type { Army, Faction, GameState } from './types.js';

function enemyAdjacent(s: GameState, a: Army): [number, number] | null {
  for (const [nc, nr] of neighbors(a.c, a.r)) {
    const enemy = armyAt(s, nc, nr) ?? cityAt(s, nc, nr);
    if (
      enemy &&
      enemy.owner !== a.owner &&
      faction(s, enemy.owner).kind === 'human' &&
      atWar(s, a.owner, enemy.owner)
    )
      return [nc, nr];
  }
  return null;
}

function stepAlong(
  s: GameState,
  a: Army,
  path: [number, number][],
  mp: number,
  stopNearEnemy: boolean,
): void {
  const full = mp;
  for (let i = 0; i < path.length - 1; i++) {
    const [nc, nr] = path[i]!;
    if (armyAt(s, nc, nr)) break;
    const city = cityAt(s, nc, nr);
    if (city && city.owner !== a.owner) break;
    const cost = TERRAIN[terrainAt(nc, nr)!].cost;
    if (cost > mp && !(mp === full && i === 0)) break;
    mp -= cost;
    a.c = nc;
    a.r = nr;
    if (mp <= 0) break;
    if (stopNearEnemy && enemyAdjacent(s, a)) break;
  }
}

function actFaction(ctx: Ctx, ai: Faction): void {
  const s = ctx.s;
  const S = seasonOf(s.turn);
  const cap = capitalOf(s, ai.id);
  if (!cap) {
    ai.alive = false;
    return;
  }
  const enemies = humanFactions(s).filter((h) => atWar(s, ai.id, h.id));
  const army = armiesOf(s, ai.id)[0];
  if (!army) {
    ai.recruitCd--;
    if (ai.recruitCd <= 0 && !armyAt(s, cap.c, cap.r)) {
      s.armies.push({
        id: newId(s, 'a'),
        owner: ai.id,
        c: cap.c,
        r: cap.r,
        str: RULES.aiRecruitStr,
        morale: 80,
        mp: 0,
        moved: false,
      });
      ai.recruitCd = RULES.aiRecruitCooldown;
    }
    return;
  }
  const goHome = (mp: number, within: number) => {
    if (hexDistance([army.c, army.r], [cap.c, cap.r]) <= within) return;
    const p = pathTo(s, army, cap.c, cap.r);
    if (p) stepAlong(s, army, p, mp, false);
  };
  if (!enemies.length) {
    army.str = Math.min(RULES.aiPeaceStrCap, army.str + 2);
    army.morale = Math.min(95, army.morale + 5);
    goHome(1, 2);
    return;
  }
  army.str = Math.min(RULES.aiWarStrCap, army.str + 1);
  if (S.id === 'rain') {
    army.morale = Math.min(95, army.morale + 5);
    return;
  }
  if (army.str < RULES.aiWeakStr) {
    goHome(S.move, 1);
    return;
  }
  let adj = enemyAdjacent(s, army);
  if (!adj) {
    const targets: [number, number][] = [];
    for (const h of enemies) {
      for (const c of s.cities) if (c.owner === h.id) targets.push([c.c, c.r]);
      for (const a of s.armies) if (a.owner === h.id) targets.push([a.c, a.r]);
    }
    targets.sort((p, q) => hexDistance([army.c, army.r], p) - hexDistance([army.c, army.r], q));
    const target = targets[0];
    if (target) {
      const p = pathTo(s, army, target[0], target[1]);
      if (p) stepAlong(s, army, p, S.move, true);
    }
    adj = enemyAdjacent(s, army);
  }
  if (!adj) return;
  const da = armyAt(s, adj[0], adj[1]);
  const dc = cityAt(s, adj[0], adj[1]);
  const defTotal = (da?.str ?? 0) + (dc?.garrison ?? 0);
  if (army.str >= defTotal * (dc ? 1.0 : 0.6)) resolveBattle(ctx, army, adj[0], adj[1]);
}

/** All AI factions take their season actions. */
export function runAi(ctx: Ctx): void {
  for (const ai of aiFactions(ctx.s)) {
    if (!humanFactions(ctx.s).length) return;
    actFaction(ctx, ai);
  }
}
