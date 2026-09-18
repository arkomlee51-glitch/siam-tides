import { RULES, TERRAIN } from './data.js';
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
import type { Army, BattleReport, City, FactionId } from './types.js';

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
  ctx.s.ready = ctx.s.ready.filter((x) => x !== fid);
  emit(ctx, null, 'ending', 'bad', `🕯️ ${f.name}เสียเมืองหลวงและล่มสลาย`);
  chronicle(ctx.s, fid, `${f.name}ล่มสลาย`);
}

export function captureCity(ctx: Ctx, city: City, newOwner: FactionId): void {
  const s = ctx.s;
  const prevOwner = city.owner;
  const prev = faction(s, prevOwner);
  const winner = faction(s, newOwner);
  const wasCapital = city.capital;
  city.owner = newOwner;
  city.capital = false;
  city.garrison = RULES.capturedGarrison;
  city.baseGarrison = RULES.capturedBaseGarrison;
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
  const t = terrainAt(tc, tr)!;
  const tDef = TERRAIN[t].def;
  const walls = !!city?.buildings.includes('walls');
  const isCapital = !!city?.capital;
  const cityMod = city
    ? RULES.cityDefense * (walls ? RULES.wallsDefense : 1) * (city.capital ? RULES.capitalDefense : 1)
    : 1;
  const attF = faction(s, att.owner);
  const defF = faction(s, defender);
  const pAtk = hasPerk(attF, 'powder') ? 1.2 : 1;
  const pDef = hasPerk(defF, 'powder') ? 1.2 : 1;
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

  const place = city ? city.name : TERRAIN[t].short;
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
    `ภูมิประเทศ${TERRAIN[t].short} ปรับพลังรับ ×${tDef}${city ? `, ตัวเมือง ×${cityMod.toFixed(2)}${walls ? ' (มีกำแพง)' : ''}${isCapital ? ' (เมืองหลวง)' : ''}` : ''}`,
  ];
  if (pAtk > 1 || pDef > 1) lines.push('วิทยาการดินปืนเพิ่มพลัง ×1.2');
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
