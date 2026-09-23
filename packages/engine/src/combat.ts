import { getChapterById } from './content/chapters/index.js';
import type { ChapterDefinition } from './content/schema.js';
import { hasPerk } from './economy.js';
import { hexDistance, neighbors, terrainAt } from './hex.js';
import { randRange } from './rng.js';
import {
  armyAt,
  capitalOf,
  chronicle,
  cityAt,
  citiesOf,
  clamp,
  emit,
  faction,
  relation,
  removeArmy,
  seasonOf,
} from './state.js';
import type { Ctx } from './state.js';
import type { Army, BattleReport, City, Faction, FactionId, PerkId } from './types.js';

/**
 * Combined multiplier a faction's unlocked perks apply to combat power, generic over
 * which chapter is active — same "perks declare effects as data" pattern as
 * `economy.ts`'s `resourceMultiplier` (docs/adr/0007 Addendum 4). 1 when no unlocked
 * perk grants a combat bonus.
 */
export function combatMultiplier(f: Faction, chapter: ChapterDefinition): number {
  let m = 1;
  for (const perk of chapter.perks) {
    if (!hasPerk(f, perk.id as PerkId)) continue;
    for (const eff of perk.effects) {
      if (eff.kind === 'combatMultiplier') m *= eff.multiplier;
    }
  }
  return m;
}

function retreatTile(ctx: Ctx, army: Army, from: Army): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = -1;
  for (const [nc, nr] of neighbors(army.c, army.r)) {
    if (!terrainAt(nc, nr) || armyAt(ctx.s, nc, nr)) continue;
    const city = cityAt(ctx.s, nc, nr);
    if (city && city.owner !== army.owner) continue;
    const d = hexDistance([nc, nr], [from.c, from.r]);
    if (d > bd) {
      bd = d;
      best = [nc, nr];
    }
  }
  return best;
}

function eliminateHuman(ctx: Ctx, fid: FactionId): void {
  const f = faction(ctx.s, fid);
  f.alive = false;
  f.ending = 'ashes';
  ctx.s.armies = ctx.s.armies.filter((a) => a.owner !== fid);
  ctx.s.pending = ctx.s.pending.filter((p) => p.faction !== fid);
  ctx.s.proposals = (ctx.s.proposals ?? []).filter((p) => p.from !== fid && p.to !== fid);
  ctx.s.ready = ctx.s.ready.filter((x) => x !== fid);
  emit(ctx, null, 'ending', 'bad', `🕯️ ${f.name}เสียเมืองหลวงและล่มสลาย`);
  chronicle(ctx.s, fid, `${f.name}ล่มสลาย`);
}

/**
 * Combined city-defense multiplier from a city's buildings, as declared in chapter data
 * (`BuildingEffect` kind `cityDefenseMultiplier`) — replaces the old literal
 * `buildings.includes('walls')` check (docs/adr/0007 Addendum 7). Returns the
 * multiplier plus the names of the buildings that contributed, for the battle report.
 */
export function buildingDefenseMultiplier(
  chapter: ChapterDefinition,
  buildings: readonly string[],
): { multiplier: number; names: string[] } {
  let multiplier = 1;
  const names: string[] = [];
  for (const b of buildings) {
    const def = chapter.buildings[b];
    for (const eff of def?.effects ?? []) {
      if (eff.kind !== 'cityDefenseMultiplier') continue;
      multiplier *= eff.multiplier;
      names.push(def!.name);
    }
  }
  return { multiplier, names };
}

export function captureCity(ctx: Ctx, city: City, newOwner: FactionId): void {
  const s = ctx.s;
  const R = getChapterById(s.chapterId).rules;
  const prevOwner = city.owner;
  const prev = faction(s, prevOwner);
  const winner = faction(s, newOwner);
  const wasCapital = city.capital;
  city.owner = newOwner;
  city.capital = false;
  city.garrison = R.capturedGarrison;
  city.baseGarrison = R.capturedBaseGarrison;
  chronicle(s, newOwner, `ยึดเมือง${city.name}จาก${prev.name}`);
  chronicle(s, prevOwner, `เสียเมือง${city.name}ให้${winner.name}`);
  if (winner.kind === 'human') {
    winner.stats.captures++;
    for (const other of Object.values(s.factions)) {
      if (other.kind !== 'ai' || !other.alive || other.id === prevOwner) continue;
      const rel = relation(s, other.id, newOwner);
      if (!rel.war) rel.rel -= 10;
    }
  }
  if (prev.kind === 'human') {
    if (wasCapital) eliminateHuman(ctx, prevOwner);
    return;
  }
  if (!citiesOf(s, prevOwner).length) {
    prev.alive = false;
    for (const other of Object.values(s.factions))
      if (other.id !== prevOwner) relation(s, other.id, prevOwner).war = false;
    s.armies = s.armies.filter((a) => a.owner !== prevOwner);
    emit(ctx, null, 'diplomacy', 'info', `${prev.name}ล่มสลาย`);
    chronicle(s, null, `${prev.name}ล่มสลาย`);
  } else if (wasCapital) {
    const next = capitalOf(s, prevOwner);
    if (next) next.capital = true;
  }
}

/** Auto-resolve a battle: `att` attacks the tile (tc, tr). Mutates state and returns a report. */
export function resolveBattle(ctx: Ctx, att: Army, tc: number, tr: number): BattleReport {
  const s = ctx.s;
  const S = seasonOf(s.turn);
  const defArmy = armyAt(s, tc, tr);
  const city = cityAt(s, tc, tr);
  const defender = (defArmy ?? city)!.owner;
  const chapter = getChapterById(s.chapterId);
  const t = terrainAt(tc, tr)!;
  const terrain = chapter.terrain[t]!;
  const tDef = terrain.def;
  const fortify = buildingDefenseMultiplier(chapter, city?.buildings ?? []);
  const isCapital = !!city?.capital;
  const cityMod = city
    ? chapter.rules.cityDefense * fortify.multiplier * (city.capital ? chapter.rules.capitalDefense : 1)
    : 1;
  const attF = faction(s, att.owner);
  const defF = faction(s, defender);
  const pAtk = combatMultiplier(attF, chapter);
  const pDef = combatMultiplier(defF, chapter);
  const atkStr = att.str;
  const atkMor = att.morale;
  const g0 = city?.garrison ?? 0;
  const defStr = (defArmy?.str ?? 0) + g0;
  const defMor = defArmy?.morale ?? 80;
  const A = atkStr * (atkMor / 100) * S.atk * pAtk * randRange(s, 0.85, 1.15);
  const D = Math.max(1, defStr) * (defMor / 100) * tDef * cityMod * pDef * randRange(s, 0.85, 1.15);
  const ratio = A / (A + D);
  const win = A > D;
  const attLoss = Math.round(win ? atkStr * 0.35 * (1 - ratio) : atkStr * (0.3 + 0.5 * (1 - ratio)));
  const defLoss = Math.round(win ? defStr * (0.3 + 0.5 * ratio) : defStr * 0.35 * ratio);

  att.str -= attLoss;
  att.morale = clamp(att.morale + (win ? 8 : -20), 20, 100);
  att.mp = 0;
  att.moved = true;
  if (defArmy) {
    defArmy.str -= defLoss;
    defArmy.morale = clamp(defArmy.morale + (win ? -20 : 8), 20, 100);
  } else if (city) {
    city.garrison = Math.max(0, city.garrison - defLoss);
  }
  for (const f of [attF, defF]) {
    if (f.kind !== 'human') continue;
    f.stats.battles++;
    if ((f === attF) === win) f.stats.wins++;
  }

  const place = city ? city.name : terrain.short;
  let captured = false;
  let routed = false;
  if (win) {
    if (defArmy) {
      const back = city ? null : retreatTile(ctx, defArmy, att);
      if (city || defArmy.str < 6 || !back) {
        removeArmy(s, defArmy);
        routed = true;
      } else {
        defArmy.c = back[0];
        defArmy.r = back[1];
      }
    }
    if (city && att.str >= 6) {
      captureCity(ctx, city, att.owner);
      att.c = tc;
      att.r = tr;
      captured = true;
    }
  } else if (defArmy && defArmy.str < 6) {
    removeArmy(s, defArmy);
    routed = true;
  }
  const attackerDestroyed = att.str < 6;
  if (attackerDestroyed) removeArmy(s, att);

  const lines = [
    `ฝ่ายบุก ${attF.name}: กำลัง ${atkStr} ขวัญ ${atkMor}% ได้พลังรบ ${A.toFixed(0)}`,
    `ฝ่ายรับ ${defF.name}: กำลัง ${defStr}${city ? ` (รวมกองรักษาเมือง ${g0})` : ''} ขวัญ ${defMor}% ได้พลังรบ ${D.toFixed(0)}`,
    `${S.icon} ${S.name} ปรับพลังบุก ×${S.atk}`,
    `ภูมิประเทศ${terrain.short} ปรับพลังรับ ×${tDef}${city ? `, ตัวเมือง ×${cityMod.toFixed(2)}${fortify.names.length ? ` (มี${fortify.names.join('/')})` : ''}${isCapital ? ' (เมืองหลวง)' : ''}` : ''}`,
  ];
  if (pAtk !== 1) lines.push(`วิทยาการของ${attF.name}เพิ่มพลังบุก ×${pAtk.toFixed(2)}`);
  if (pDef !== 1) lines.push(`วิทยาการของ${defF.name}เพิ่มพลังรับ ×${pDef.toFixed(2)}`);
  lines.push(`ความสูญเสีย: ฝ่ายบุก −${attLoss}, ฝ่ายรับ −${defLoss}`);
  if (captured) lines.push(`🏯 ยึดเมือง${place}ได้`);
  else if (routed) lines.push('ทัพฝ่ายรับแตกพ่าย');
  if (attackerDestroyed) lines.push('ทัพฝ่ายบุกถูกทำลาย');

  const report: BattleReport = {
    attacker: att.owner,
    defender,
    place,
    c: tc,
    r: tr,
    win,
    captured,
    routed,
    attackerDestroyed,
    attLoss,
    defLoss,
    atkPower: Math.round(A),
    defPower: Math.round(D),
    lines,
  };
  const audience = [attF, defF].filter((f) => f.kind === 'human').map((f) => f.id);
  if (audience.length) {
    const humanWon = (attF.kind === 'human') === win;
    emit(
      ctx,
      audience,
      'battle',
      humanWon ? 'good' : 'bad',
      `⚔️ ${attF.name}บุก${place}: ${win ? 'ฝ่ายบุกชนะ' : 'ฝ่ายรับต้านไว้ได้'}${captured ? ' และยึดเมืองได้' : ''} (บุก −${attLoss}, รับ −${defLoss})`,
      { battle: report },
    );
  }
  return report;
}
