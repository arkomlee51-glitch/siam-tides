import { runAi } from './ai.js';
import { RESOURCE_IDS } from './data.js';
import { getChapterById } from './content/chapters/index.js';
import type { ChapterDefinition } from './content/schema.js';
import { checkPerks, computeIncome, gainFaith, gainKnowledge } from './economy.js';
import { allHumansGone, finishGame } from './endings.js';
import { hexDistance, terrainAt } from './hex.js';
import { offeringPower, queueOffer } from './powers.js';
import { chance, pick } from './rng.js';
import {
  aiFactions,
  armiesOf,
  capitalOf,
  chronicle,
  citiesOf,
  clamp,
  emit,
  faction,
  humanFactions,
  relation,
  seasonOf,
  yearOf,
} from './state.js';
import type { Ctx } from './state.js';
import type { Faction, GameState, PowerId } from './types.js';

function collectIncome(ctx: Ctx, f: Faction): void {
  const inc = computeIncome(ctx.s, f);
  for (const k of RESOURCE_IDS) {
    if (k === 'know') gainKnowledge(f, inc.know);
    else if (k === 'faith') gainFaith(f, inc.faith);
    else f.res[k] += inc[k];
  }
  if (f.res.rice < 0) {
    f.res.rice = 0;
    f.stability -= 10;
    for (const a of armiesOf(ctx.s, f.id)) a.morale = clamp(a.morale - 15, 20, 100);
    emit(ctx, [f.id], 'economy', 'bad', 'ข้าวไม่พอเลี้ยงกองทัพ เสถียรภาพ −10 และขวัญทัพลดลง');
  }
}

/** Sum of every `stabilityPerCity` building effect across a faction's cities (ADR-0007 Addendum 5). */
export function buildingStabilityBonus(s: GameState, f: Faction, chapter: ChapterDefinition): number {
  let bonus = 0;
  for (const c of citiesOf(s, f.id)) {
    for (const b of c.buildings) {
      for (const eff of chapter.buildings[b]?.effects ?? []) {
        if (eff.kind === 'stabilityPerCity') bonus += eff.amount;
      }
    }
  }
  return bonus;
}

/** True when every foreign power the chapter registers currently has patience >= 2 (ADR-0007 Addendum 5). */
export function allPowersPatient(f: Faction, chapter: ChapterDefinition): boolean {
  const ids = Object.keys(chapter.foreignPowers) as PowerId[];
  return ids.length > 0 && ids.every((p) => f.powers[p].patience >= 2);
}

function internalAffairs(ctx: Ctx, f: Faction, chapter: ChapterDefinition): void {
  const s = ctx.s;
  const stabilityFromBuildings = buildingStabilityBonus(s, f, chapter);
  const wars = Object.values(s.factions).filter(
    (o) => o.alive && o.id !== f.id && relation(s, o.id, f.id).war,
  ).length;
  const am = Math.abs(f.meter);
  const R = chapter.rules;
  f.stability = clamp(f.stability + stabilityFromBuildings - wars * 2 - (am > R.dangerZone ? 2 : 0), 0, 100);
  if (f.stability < 15) {
    const lost = Math.round(f.res.wealth * 0.3);
    f.res.wealth -= lost;
    f.stability += 15;
    for (const a of armiesOf(s, f.id)) a.morale = clamp(a.morale - 25, 20, 100);
    emit(ctx, [f.id], 'economy', 'bad', `เกิดกบฏในหัวเมือง เสียทรัพย์ ${lost} และขวัญทัพตกต่ำ`);
    chronicle(s, f.id, 'เกิดกบฏในหัวเมือง');
  }
  if (am <= R.balancedZone && allPowersPatient(f, chapter)) {
    gainKnowledge(f, R.balancedKnowBonus);
    emit(ctx, [f.id], 'power', 'good', `🎋 ไผ่ลู่ลม: รับวิทยาการจากทุกฝ่าย ความรู้ +${R.balancedKnowBonus}`);
  }
  if (am > R.dangerZone) {
    f.sovereignty -= 4;
    f.extremeTurns++;
    emit(
      ctx,
      [f.id],
      'power',
      'bad',
      `อิทธิพลต่างชาติครอบงำราชสำนัก เอกราช −4 (สะสม ${f.extremeTurns}/${R.extremeLimit} ฤดู)`,
    );
  }
  if (f.meter !== 0) f.meter -= Math.sign(f.meter);
  f.sovereignty = clamp(f.sovereignty, 0, 100);
  checkPerks(ctx, f);
}

/** `disasterLossReduction` effect (if any) a city's buildings provide against `disaster` (ADR-0007 Addendum 5). */
export function disasterMitigation(
  chapter: ChapterDefinition,
  buildings: readonly string[],
  disaster: string,
) {
  for (const b of buildings) {
    for (const eff of chapter.buildings[b]?.effects ?? []) {
      if (eff.kind === 'disasterLossReduction' && eff.disaster === disaster) return eff;
    }
  }
  return undefined;
}

function seasonalEvents(ctx: Ctx, humans: Faction[], chapter: ChapterDefinition): void {
  const s = ctx.s;
  const R = chapter.rules;
  const NS = seasonOf(s.turn);
  const ais = aiFactions(s);
  for (const f of humans) {
    if (NS.id === 'rain' && chance(s, 0.35)) {
      const floodProne = citiesOf(s, f.id).filter((c) => {
        const t = terrainAt(c.c, c.r);
        return !!t && (chapter.terrain[t]?.disasterExposure ?? []).includes('flood');
      });
      const city = pick(s, floodProne);
      if (city) {
        const mitigation = disasterMitigation(chapter, city.buildings, 'flood');
        const loss = mitigation ? mitigation.reducedLoss : 20;
        f.res.rice = Math.max(0, f.res.rice - loss);
        emit(
          ctx,
          [f.id],
          'disaster',
          'bad',
          `🌊 น้ำท่วมรอบเมือง${city.name} ข้าวเสียหาย ${loss}${mitigation ? ' (ยุ้งฉางช่วยไว้ได้)' : ''}`,
        );
      }
    }
    if (NS.id === 'cool') {
      if (chance(s, 0.25)) {
        gainFaith(f, 6);
        emit(ctx, [f.id], 'economy', 'good', '🪔 งานบุญเดือนสิบสองคึกคัก ศรัทธา +6');
      }
      const calm = ais.filter((ai) => !relation(s, ai.id, f.id).war);
      const irritated = chance(s, 0.25) ? pick(s, calm) : undefined;
      if (irritated) {
        relation(s, irritated.id, f.id).rel -= 15;
        emit(
          ctx,
          [f.id],
          'diplomacy',
          'warn',
          `⚠️ กระทบกระทั่งตามชายแดนกับ${irritated.name} ความสัมพันธ์ −15`,
        );
      }
      for (const ai of ais) {
        const rel = relation(s, ai.id, f.id);
        if (!rel.war && rel.rel <= R.aiWarThreshold && chance(s, R.aiWarChance)) {
          rel.war = true;
          emit(ctx, [f.id], 'diplomacy', 'bad', `⚔️ ${ai.name}ประกาศสงครามกับ${f.name}`);
          chronicle(s, f.id, `${ai.name}ประกาศสงคราม`);
        }
      }
    }
    if (NS.id === 'hot') {
      if (chance(s, 0.2)) {
        f.res.rice = Math.max(0, f.res.rice - 10);
        emit(ctx, [f.id], 'disaster', 'bad', '🔥 ภัยแล้ง ข้าว −10');
      }
      for (const ai of ais) {
        const rel = relation(s, ai.id, f.id);
        if (!rel.war && rel.rel >= 60 && chance(s, 0.35)) {
          f.res.wealth += 10;
          emit(ctx, [f.id], 'diplomacy', 'good', `🎁 ${ai.name}ส่งของขวัญมาเชื่อมไมตรี ทรัพย์ +10`);
        }
      }
      queueOffer(ctx, f, offeringPower(chapter, yearOf(s.turn)));
    }
  }
}

/** Resolve the current season for everyone and advance to the next one. */
export function resolveSeason(ctx: Ctx): void {
  const s = ctx.s;
  const chapter = getChapterById(s.chapterId);
  for (const f of humanFactions(s)) collectIncome(ctx, f);

  runAi(ctx);
  if (allHumansGone(s)) return finishGame(ctx);

  const humans = humanFactions(s);
  for (const f of humans) internalAffairs(ctx, f, chapter);

  s.turn++;
  s.ready = [];
  if (s.turn > s.maxTurn) {
    s.turn = s.maxTurn;
    return finishGame(ctx);
  }
  const NS = seasonOf(s.turn);

  for (const a of s.armies) {
    if (faction(s, a.owner).kind !== 'human') continue;
    if (!a.moved) a.morale = Math.min(100, a.morale + 5);
    a.moved = false;
    a.mp = NS.move;
  }
  for (const c of s.cities) c.garrison = Math.min(c.baseGarrison, c.garrison + (c.capital ? 3 : 2));

  for (const ai of aiFactions(s))
    for (const f of humans) {
      const rel = relation(s, ai.id, f.id);
      if (rel.war) continue;
      rel.rel += rel.rel > 0 ? -1 : rel.rel < 0 ? 1 : 0;
      if (citiesOf(s, f.id).length > chapter.rules.expansionIrritation) rel.rel -= 1;
      rel.rel = clamp(rel.rel, -100, 100);
    }

  for (const f of humans) {
    const home = capitalOf(s, f.id);
    if (!home) continue;
    for (const a of s.armies) {
      if (a.owner === f.id || !relation(s, a.owner, f.id).war) continue;
      if (hexDistance([a.c, a.r], [home.c, home.r]) <= 3)
        emit(
          ctx,
          [f.id],
          'army',
          'warn',
          `⚠️ ทัพ${faction(s, a.owner).name} (${a.str}) ประชิด${home.name} อย่าปล่อยเมืองหลวงว่าง`,
        );
    }
  }

  seasonalEvents(ctx, humans, chapter);
  emit(ctx, null, 'season', 'info', `${NS.icon} เข้าสู่${NS.name} ปีที่ ${yearOf(s.turn)}`);
}
