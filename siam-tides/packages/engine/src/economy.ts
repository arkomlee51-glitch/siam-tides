import { BUILDINGS, PERKS, RESOURCE_IDS, RULES, TERRAIN } from './data.js';
import { isCoastal, isRiver, neighbors, terrainAt } from './hex.js';
import { armiesOf, chronicle, citiesOf, emit, seasonOf } from './state.js';
import type { Ctx } from './state.js';
import type { City, Cost, Faction, FactionId, GameState, PerkId, Resources } from './types.js';

const zero = (): Resources => ({ rice: 0, man: 0, wealth: 0, faith: 0, know: 0 });
function addInto(target: Resources, src: Partial<Resources>): void {
  for (const k of RESOURCE_IDS) target[k] += src[k] ?? 0;
}

/** Per-season yield of a city before seasonal modifiers. */
export function cityYield(city: City): Resources {
  const y: Resources = { ...RULES.cityBaseYield };
  for (const [c, r] of [[city.c, city.r] as [number, number], ...neighbors(city.c, city.r)]) {
    const t = terrainAt(c, r);
    if (t) addInto(y, TERRAIN[t].yield);
    if (isRiver(c, r)) addInto(y, RULES.riverBonus);
  }
  if (isCoastal(city.c, city.r)) y.wealth += RULES.coastalWealth;
  for (const b of city.buildings) addInto(y, BUILDINGS[b].yield);
  for (const k of RESOURCE_IDS) y[k] = Math.round(y[k]);
  return y;
}

export const hasPerk = (f: Faction, id: PerkId): boolean => f.perks.includes(id);
export const upkeepOf = (s: GameState, fid: FactionId): number =>
  armiesOf(s, fid).reduce((sum, a) => sum + Math.ceil(a.str / RULES.upkeepPerStr), 0);

export interface Income extends Resources {
  upkeep: number;
}
/** Net income a faction receives when the current season resolves. */
export function computeIncome(s: GameState, f: Faction): Income {
  const S = seasonOf(s.turn);
  const inc = zero();
  for (const city of citiesOf(s, f.id)) addInto(inc, cityYield(city));
  inc.rice *= S.rice * (hasPerk(f, 'irrig') ? 1.2 : 1);
  inc.man *= S.man;
  if (hasPerk(f, 'print')) inc.know *= 1.3;
  for (const k of RESOURCE_IDS) inc[k] = Math.round(inc[k]);
  const upkeep = upkeepOf(s, f.id);
  inc.rice -= upkeep;
  return { ...inc, upkeep };
}

export function scaleCost(cost: Cost, m: number): Cost {
  const out: Cost = {};
  for (const k of RESOURCE_IDS) {
    const v = cost[k];
    if (v !== undefined) out[k] = Math.ceil(v * m);
  }
  return out;
}
export const canPay = (res: Resources, cost: Cost): boolean =>
  RESOURCE_IDS.every((k) => res[k] >= (cost[k] ?? 0));
export function pay(res: Resources, cost: Cost): void {
  for (const k of RESOURCE_IDS) res[k] -= cost[k] ?? 0;
}

export function gainKnowledge(f: Faction, n: number): void {
  f.res.know += n;
  if (n > 0) f.knowTotal += n;
}
export function gainFaith(f: Faction, n: number): void {
  f.res.faith += n;
  if (n > 0) f.faithTotal += n;
}

export function checkPerks(ctx: Ctx, f: Faction): void {
  for (const p of PERKS) {
    if (f.knowTotal >= p.at && !hasPerk(f, p.id)) {
      f.perks.push(p.id);
      emit(ctx, [f.id], 'perk', 'good', `📜 ค้นพบวิทยาการ “${p.name}” ${p.desc}`);
      chronicle(ctx.s, f.id, `ค้นพบวิทยาการ${p.name}`);
    }
  }
}
