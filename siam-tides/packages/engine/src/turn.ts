import { runAi } from './ai.js';
import { RESOURCE_IDS, RULES } from './data.js';
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
import type { Faction } from './types.js';

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

function internalAffairs(ctx: Ctx, f: Faction): void {
  const s = ctx.s;
  const temples = citiesOf(s, f.id).filter((c) => c.buildings.includes('temple')).length;
  const wars = Object.values(s.factions).filter(
    (o) => o.alive && o.id !== f.id && relation(s, o.id, f.id).war,
  ).length;
  const am = Math.abs(f.meter);
  f.stability = clamp(f.stability + temples - wars * 2 - (am > RULES.dangerZone ? 2 : 0), 0, 100);
  if (f.stability < 15) {
    const lost = Math.round(f.res.wealth * 0.3);
    f.res.wealth -= lost;
    f.stability += 15;
    for (const a of armiesOf(s, f.id)) a.morale = clamp(a.morale - 25, 20, 100);
    emit(ctx, [f.id], 'economy', 'bad', `เกิดกบฏในหัวเมือง เสียทรัพย์ ${lost} และขวัญทัพตกต่ำ`);
    chronicle(s, f.id, 'เกิดกบฏในหัวเมือง');
  }
  if (am <= RULES.balancedZone && f.powers.lion.patience >= 2 && f.powers.eagle.patience >= 2) {
    gainKnowledge(f, RULES.balancedKnowBonus);
    emit(
      ctx,
      [f.id],
      'power',
      'good',
      `🎋 ไผ่ลู่ลม: รับวิทยาการจากทั้งสองฝ่าย ความรู้ +${RULES.balancedKnowBonus}`,
    );
  }
  if (am > RULES.dangerZone) {
    f.sovereignty -= 4;
    f.extremeTurns++;
    emit(
      ctx,
      [f.id],
      'power',
      'bad',
      `อิทธิพลต่างชาติครอบงำราชสำนัก เอกราช −4 (สะสม ${f.extremeTurns}/${RULES.extremeLimit} ฤดู)`,
    );
  }
  if (f.meter !== 0) f.meter -= Math.sign(f.meter);
  f.sovereignty = clamp(f.sovereignty, 0, 100);
  checkPerks(ctx, f);
}

function seasonalEvents(ctx: Ctx, humans: Faction[]): void {
  const s = ctx.s;
  const NS = seasonOf(s.turn);
  const ais = aiFactions(s);
  for (const f of humans) {
    if (NS.id === 'rain' && chance(s, 0.35)) {
      const lowland = citiesOf(s, f.id).filter((c) => terrainAt(c.c, c.r) === 'C');
      const city = pick(s, lowland);
      if (city) {
        const saved = city.buildings.includes('granary');
        const loss = saved ? 8 : 20;
        f.res.rice = Math.max(0, f.res.rice - loss);
        emit(
          ctx,
          [f.id],
          'disaster',
          'bad',
          `🌊 น้ำท่วมรอบเมือง${city.name} ข้าวเสียหาย ${loss}${saved ? ' (ยุ้งฉางช่วยไว้ได้)' : ''}`,
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
        if (!rel.war && rel.rel <= RULES.aiWarThreshold && chance(s, RULES.aiWarChance)) {
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
      queueOffer(ctx, f, offeringPower(yearOf(s.turn)));
    }
  }
}

/** Resolve the current season for everyone and advance to the next one. */
export function resolveSeason(ctx: Ctx): void {
  const s = ctx.s;
  for (const f of humanFactions(s)) collectIncome(ctx, f);

  runAi(ctx);
  if (allHumansGone(s)) return finishGame(ctx);

  const humans = humanFactions(s);
  for (const f of humans) internalAffairs(ctx, f);

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
      if (citiesOf(s, f.id).length > RULES.expansionIrritation) rel.rel -= 1;
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

  seasonalEvents(ctx, humans);
  emit(ctx, null, 'season', 'info', `${NS.icon} เข้าสู่${NS.name} ปีที่ ${yearOf(s.turn)}`);
}
