import { RESOURCE_IDS } from './data.js';
import { getChapterById } from './content/chapters/index.js';
import type { ChapterDefinition, CoreResourceId } from './content/schema.js';
import { isCoastal, isRiver, neighbors, terrainAt } from './hex.js';
import { armiesOf, chronicle, citiesOf, emit, seasonOf } from './state.js';
import type { Ctx } from './state.js';
import type { City, Cost, Faction, FactionId, GameState, PerkId, Resources } from './types.js';

const zero = (): Resources => ({ rice: 0, man: 0, wealth: 0, faith: 0, know: 0 });
function addInto(target: Resources, src: Partial<Resources>): void {
  for (const k of RESOURCE_IDS) target[k] += src[k] ?? 0;
}

/**
 * Per-season yield of a city before seasonal modifiers, from the given chapter's
 * terrain/building/rule data (docs/adr/0007 Addendum 7). Callers holding a
 * `GameState` pass `getChapterById(s.chapterId)`.
 */
export function cityYield(city: City, chapter: ChapterDefinition): Resources {
  const R = chapter.rules;
  const y: Resources = { ...R.cityBaseYield };
  for (const [c, r] of [[city.c, city.r] as [number, number], ...neighbors(city.c, city.r)]) {
    const t = terrainAt(c, r);
    if (t) addInto(y, chapter.terrain[t]?.yield ?? {});
    if (isRiver(c, r)) addInto(y, R.riverBonus);
  }
  if (isCoastal(city.c, city.r)) y.wealth += R.coastalWealth;
  for (const b of city.buildings) addInto(y, chapter.buildings[b]?.yield ?? {});
  for (const k of RESOURCE_IDS) y[k] = Math.round(y[k]);
  return y;
}

export const hasPerk = (f: Faction, id: PerkId): boolean => f.perks.includes(id);
export const upkeepOf = (s: GameState, fid: FactionId): number =>
  armiesOf(s, fid).reduce(
    (sum, a) => sum + Math.ceil(a.str / getChapterById(s.chapterId).rules.upkeepPerStr),
    0,
  );

/**
 * Combined multiplier a faction's unlocked perks apply to one core resource, generic
 * over which chapter is active (docs/adr/0007 Addendum 4 — perks declare effects as
 * data, `economy.ts`/`combat.ts` apply them the same way regardless of chapter). 1 when
 * no unlocked perk touches that resource.
 */
export function resourceMultiplier(f: Faction, resource: CoreResourceId, chapter: ChapterDefinition): number {
  let m = 1;
  for (const perk of chapter.perks) {
    if (!hasPerk(f, perk.id as PerkId)) continue;
    for (const eff of perk.effects) {
      if (eff.kind === 'resourceMultiplier' && eff.resource === resource) m *= eff.multiplier;
    }
  }
  return m;
}

export interface Income extends Resources {
  upkeep: number;
}
/** Net income a faction receives when the current season resolves. */
export function computeIncome(s: GameState, f: Faction): Income {
  const chapter = getChapterById(s.chapterId);
  const S = seasonOf(s.turn);
  const inc = zero();
  for (const city of citiesOf(s, f.id)) addInto(inc, cityYield(city, chapter));
  // Legacy from a previous chapter: an ongoing multiplier on this faction's city yields
  const legacy = f.legacy?.yieldMultiplier;
  if (legacy) for (const k of RESOURCE_IDS) inc[k] *= legacy[k] ?? 1;
  inc.rice *= S.rice * resourceMultiplier(f, 'rice', chapter);
  inc.man *= S.man;
  inc.know *= resourceMultiplier(f, 'know', chapter);
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
  const chapter = getChapterById(ctx.s.chapterId);
  for (const p of chapter.perks) {
    const id = p.id as PerkId;
    if (f.knowTotal >= p.at && !hasPerk(f, id)) {
      f.perks.push(id);
      emit(ctx, [f.id], 'perk', 'good', `📜 ค้นพบวิทยาการ “${p.name}” ${p.desc}`);
      chronicle(ctx.s, f.id, `ค้นพบวิทยาการ${p.name}`);
    }
  }
}
