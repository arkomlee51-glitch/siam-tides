import { getChapterById } from './content/chapters/index.js';
import type { ChapterDefinition } from './content/schema.js';
import { resolveBattle } from './combat.js';
import { canPay, pay, scaleCost } from './economy.js';
import { hexDistance, isCoastal, key, terrainAt } from './hex.js';
import { attackTargets, reachableTiles } from './movement.js';
import { answerDecision, sendEnvoy } from './powers.js';
import { chance } from './rng.js';
import {
  aiFactions,
  armyAt,
  capitalOf,
  chronicle,
  cityAt,
  clamp,
  emit,
  humanFactions,
  newId,
  relation,
  seasonOf,
} from './state.js';
import type { Ctx } from './state.js';
import { resolveSeason } from './turn.js';
import { fmtCost } from './views.js';
import type { Action, ActionError, ActionResult, Army, Faction, FactionId, GameState } from './types.js';

export const ERROR_MESSAGES: Record<ActionError, string> = {
  GAME_OVER: 'เกมจบแล้ว',
  NOT_YOUR_FACTION: 'ไม่ใช่ฝ่ายของคุณ',
  FACTION_ELIMINATED: 'ฝ่ายของคุณล่มสลายแล้ว',
  ALREADY_READY: 'คุณจบฤดูนี้แล้ว รอผู้เล่นอื่น',
  PENDING_DECISION: 'ต้องตอบข้อเสนอของมหาอำนาจก่อน',
  NOT_FOUND: 'ไม่พบสิ่งที่ระบุ',
  NOT_OWNER: 'ไม่ใช่ของฝ่ายคุณ',
  INSUFFICIENT_RESOURCES: 'ทรัพยากรไม่พอ',
  NO_MOVES_LEFT: 'ทัพนี้ใช้แต้มเดินหมดแล้ว',
  UNREACHABLE: 'เดินไปช่องนั้นไม่ได้ในฤดูนี้',
  NOT_ADJACENT: 'เป้าหมายต้องอยู่ติดกัน',
  NOT_AT_WAR: 'ยังไม่ได้อยู่ในภาวะสงคราม',
  AT_WAR: 'ทำไม่ได้ระหว่างสงคราม',
  INVALID_LOCATION: 'ตั้งเมืองที่นี่ไม่ได้',
  ALREADY_BUILT: 'สร้างไว้แล้ว',
  NOT_COASTAL: 'ต้องเป็นเมืองติดทะเล',
  ARMY_FULL: 'ทัพเต็มแล้ว',
  RELATION_TOO_LOW: 'ความสัมพันธ์ยังไม่ถึงเกณฑ์',
  INVALID_TARGET: 'เป้าหมายไม่ถูกต้อง',
  INVALID_CHOICE: 'ตัวเลือกไม่ถูกต้อง',
  UNKNOWN_ACTION: 'ไม่รู้จักคำสั่งนี้',
};

const fail = (error: ActionError): ActionResult => ({ ok: false, error, message: ERROR_MESSAGES[error] });

function ownArmy(s: GameState, f: Faction, id: string): Army | ActionError {
  const a = s.armies.find((x) => x.id === id);
  if (!a) return 'NOT_FOUND';
  if (a.owner !== f.id) return 'NOT_OWNER';
  return a;
}

/** Why an army can't found a city here, or null if it can. */
export function foundBlocker(s: GameState, a: Army): string | null {
  const chapter = getChapterById(s.chapterId);
  const t = terrainAt(a.c, a.r);
  if (!t || t === 'M') return 'ตั้งเมืองบนเทือกเขาไม่ได้';
  if (cityAt(s, a.c, a.r)) return 'ช่องนี้มีเมืองอยู่แล้ว';
  if (s.cities.some((c) => hexDistance([c.c, c.r], [a.c, a.r]) < chapter.rules.cityMinDistance))
    return `ต้องห่างจากเมืองอื่นอย่างน้อย ${chapter.rules.cityMinDistance} ช่อง`;
  return null;
}

function aiTarget(s: GameState, target: FactionId): Faction | null {
  const t = s.factions[target];
  return t && t.kind === 'ai' && t.alive ? t : null;
}

/** Any other living faction, AI or human. */
function otherTarget(s: GameState, f: Faction, target: FactionId): Faction | null {
  const t = s.factions[target];
  return t && t.alive && t.id !== f.id ? t : null;
}

/**
 * `from` joins `into` peacefully: cities and armies change hands, `from` leaves the game.
 * Shared by paying to annex an AI and a human accepting a union proposal (ADR-0008).
 */
function absorbFaction(ctx: Ctx, into: Faction, from: Faction): void {
  const s = ctx.s;
  for (const c of s.cities) if (c.owner === from.id) Object.assign(c, { owner: into.id, capital: false });
  for (const army of s.armies)
    if (army.owner === from.id) Object.assign(army, { owner: into.id, mp: 0, moved: true });
  from.alive = false;
  for (const other of Object.values(s.factions))
    if (other.id !== from.id) relation(s, other.id, from.id).war = false;
  s.pending = s.pending.filter((d) => d.faction !== from.id);
  s.proposals = (s.proposals ?? []).filter((x) => x.from !== from.id && x.to !== from.id);
  s.ready = s.ready.filter((x) => x !== from.id);
  into.stats.annexed++;
  into.stability = clamp(into.stability + 5, 0, 100);
  emit(ctx, null, 'diplomacy', 'good', `🤝 ${from.name}เข้าร่วมกับ${into.name}โดยสันติ`);
  chronicle(s, into.id, `${from.name}เข้าร่วมแผ่นดินโดยสันติ`);
}

type Handler<A extends Action> = (
  ctx: Ctx,
  f: Faction,
  a: A,
  chapter: ChapterDefinition,
) => ActionError | null;
type Handlers = { [K in Action['type']]: Handler<Extract<Action, { type: K }>> };

const handlers: Handlers = {
  move(ctx, f, a) {
    const army = ownArmy(ctx.s, f, a.armyId);
    if (typeof army === 'string') return army;
    if (army.mp <= 0) return 'NO_MOVES_LEFT';
    const dest = reachableTiles(ctx.s, army).get(key(a.c, a.r));
    if (!dest) return 'UNREACHABLE';
    army.c = dest.c;
    army.r = dest.r;
    army.mp = dest.left;
    army.moved = true;
    return null;
  },

  attack(ctx, f, a) {
    const army = ownArmy(ctx.s, f, a.armyId);
    if (typeof army === 'string') return army;
    if (army.mp <= 0) return 'NO_MOVES_LEFT';
    if (hexDistance([army.c, army.r], [a.c, a.r]) !== 1) return 'NOT_ADJACENT';
    const enemy = armyAt(ctx.s, a.c, a.r) ?? cityAt(ctx.s, a.c, a.r);
    if (!enemy || enemy.owner === f.id) return 'INVALID_TARGET';
    if (!attackTargets(ctx.s, army).has(key(a.c, a.r))) return 'NOT_AT_WAR';
    resolveBattle(ctx, army, a.c, a.r);
    return null;
  },

  camp(ctx, f, a) {
    const army = ownArmy(ctx.s, f, a.armyId);
    if (typeof army === 'string') return army;
    if (army.mp <= 0) return 'NO_MOVES_LEFT';
    army.mp = 0;
    army.moved = true;
    army.morale = Math.min(100, army.morale + 15);
    emit(ctx, [f.id], 'army', 'good', 'ตั้งค่ายพักพล ขวัญกำลังใจ +15');
    return null;
  },

  found(ctx, f, a, chapter) {
    const s = ctx.s;
    const army = ownArmy(s, f, a.armyId);
    if (typeof army === 'string') return army;
    if (foundBlocker(s, army)) return 'INVALID_LOCATION';
    const cost = scaleCost(chapter.costs.found ?? {}, seasonOf(s.turn).build);
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, cost);
    const names = chapter.newCityNames;
    const name = names[s.cityNameIdx++ % names.length]!;
    s.cities.push({
      id: newId(s, 'c'),
      name,
      c: army.c,
      r: army.r,
      owner: f.id,
      capital: false,
      buildings: [],
      garrison: chapter.rules.newCityGarrison,
      baseGarrison: chapter.rules.newCityBaseGarrison,
    });
    army.mp = 0;
    army.moved = true;
    f.stats.founded++;
    for (const ai of aiFactions(s)) {
      const cap = capitalOf(s, ai.id);
      if (cap && hexDistance([cap.c, cap.r], [army.c, army.r]) <= 4) {
        relation(s, ai.id, f.id).rel -= 8;
        emit(ctx, [f.id], 'diplomacy', 'warn', `${ai.name}ไม่พอใจที่คุณตั้งเมืองใกล้ชายแดน`);
      }
    }
    emit(ctx, [f.id], 'city', 'good', `ตั้งเมือง${name}`);
    chronicle(s, f.id, `ตั้งเมือง${name}`);
    return null;
  },

  build(ctx, f, a, chapter) {
    const city = ctx.s.cities.find((c) => c.id === a.cityId);
    if (!city) return 'NOT_FOUND';
    if (city.owner !== f.id) return 'NOT_OWNER';
    const def = chapter.buildings[a.building];
    if (!def) return 'INVALID_TARGET';
    if (city.buildings.includes(a.building)) return 'ALREADY_BUILT';
    if (def.coastalOnly && !isCoastal(city.c, city.r)) return 'NOT_COASTAL';
    const cost = scaleCost(def.cost, seasonOf(ctx.s.turn).build);
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, cost);
    city.buildings.push(a.building);
    if (def.garrisonBonus) city.baseGarrison += def.garrisonBonus;
    emit(ctx, [f.id], 'city', 'good', `สร้าง${def.name}ที่${city.name}`);
    return null;
  },

  recruit(ctx, f, a, chapter) {
    const s = ctx.s;
    const city = s.cities.find((c) => c.id === a.cityId);
    if (!city) return 'NOT_FOUND';
    if (city.owner !== f.id) return 'NOT_OWNER';
    const here = armyAt(s, city.c, city.r);
    if (here && here.str >= chapter.rules.armyCap) return 'ARMY_FULL';
    const cost = scaleCost(chapter.costs.recruit ?? {}, seasonOf(s.turn).recruit);
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, cost);
    if (here) {
      here.str = Math.min(chapter.rules.armyCap, here.str + chapter.rules.recruitReinforce);
      emit(ctx, [f.id], 'army', 'good', `เสริมกำลังทัพที่${city.name} +${chapter.rules.recruitReinforce}`);
    } else {
      s.armies.push({
        id: newId(s, 'a'),
        owner: f.id,
        c: city.c,
        r: city.r,
        str: chapter.rules.recruitNew,
        morale: 70,
        mp: 0,
        moved: true,
      });
      emit(ctx, [f.id], 'army', 'good', `เกณฑ์ทัพใหม่ที่${city.name} เดินได้ฤดูหน้า`);
    }
    return null;
  },

  tribute(ctx, f, a, chapter) {
    // to a human, the tribute is a real gift: they receive what you paid (ADR-0008)
    return improveRelation(
      ctx,
      f,
      a.target,
      chapter.costs.tribute ?? {},
      chapter.rules.tributeGain,
      'ส่งบรรณาการ',
      'ส่งบรรณาการให้คุณ',
      true,
    );
  },

  festival(ctx, f, a, chapter) {
    return improveRelation(
      ctx,
      f,
      a.target,
      chapter.costs.festival ?? {},
      chapter.rules.festivalGain,
      'จัดงานบุญร่วมกับ',
      'จัดงานบุญร่วมกับคุณ',
      false,
    );
  },

  annex(ctx, f, a, chapter) {
    const s = ctx.s;
    const t = otherTarget(s, f, a.target);
    if (!t) return 'INVALID_TARGET';
    const rel = relation(s, t.id, f.id);
    if (rel.war) return 'AT_WAR';
    if (rel.rel < chapter.rules.annexThreshold) return 'RELATION_TOO_LOW';
    const cost = scaleCost(chapter.costs.annex ?? {}, seasonOf(s.turn).diplo);
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    if (t.kind === 'human') {
      // a human is never annexed by payment — it becomes a union proposal only they can accept;
      // the cost is paid on acceptance, not now (ADR-0008)
      s.proposals = (s.proposals ?? []).filter(
        (x) => !(x.from === f.id && x.to === t.id && x.kind === 'union'),
      );
      s.proposals.push({ id: newId(s, 'pr'), kind: 'union', from: f.id, to: t.id, turn: s.turn });
      emit(ctx, [t.id], 'diplomacy', 'info', `🤝 ${f.name}เสนอรวมแผ่นดินกับคุณ รอคำตอบ`);
      emit(ctx, [f.id], 'diplomacy', 'info', `ส่งข้อเสนอรวมแผ่นดินถึง${t.name}แล้ว รอคำตอบ`);
      chronicle(s, f.id, `เสนอรวมแผ่นดินกับ${t.name}`);
      return null;
    }
    pay(f.res, cost);
    absorbFaction(ctx, f, t);
    return null;
  },

  declareWar(ctx, f, a, chapter) {
    const s = ctx.s;
    const t = s.factions[a.target];
    if (!t || !t.alive || t.id === f.id) return 'INVALID_TARGET';
    const rel = relation(s, t.id, f.id);
    if (rel.war) return 'AT_WAR';
    rel.war = true;
    rel.rel = Math.min(rel.rel, chapter.rules.warRelationCap);
    // a pending union offer between the two is moot once they are at war (ADR-0008)
    s.proposals = (s.proposals ?? []).filter(
      (x) =>
        !(x.kind === 'union' && ((x.from === f.id && x.to === t.id) || (x.from === t.id && x.to === f.id))),
    );
    f.stability = clamp(f.stability - 5, 0, 100);
    for (const ai of aiFactions(s)) {
      if (ai.id === t.id) continue;
      const r = relation(s, ai.id, f.id);
      if (!r.war) r.rel -= 5;
    }
    // Note: declareWar requires !rel.war, and a peace proposal can only exist while
    // rel.war is true (see proposePeace/answerProposal) — so there is never a stale
    // proposal to clear here; nothing to do beyond the war declaration itself.
    const audience = t.kind === 'human' ? [f.id, t.id] : [f.id];
    emit(ctx, audience, 'diplomacy', 'bad', `⚔️ ${f.name}ประกาศสงครามกับ${t.name}`);
    chronicle(s, f.id, `ประกาศสงครามกับ${t.name}`);
    return null;
  },

  offerPeace(ctx, f, a, chapter) {
    const s = ctx.s;
    const t = aiTarget(s, a.target);
    // Human-to-human peace needs a proposal/accept flow (Phase 5).
    if (!t) return 'INVALID_TARGET';
    const rel = relation(s, t.id, f.id);
    if (!rel.war) return 'NOT_AT_WAR';
    const cost = scaleCost(chapter.costs.peace ?? {}, seasonOf(s.turn).diplo);
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, cost);
    if (chance(s, chapter.rules.peaceChance)) {
      rel.war = false;
      rel.rel = chapter.rules.peaceRelation;
      emit(ctx, [f.id], 'diplomacy', 'good', `🕊️ ${t.name}ยอมสงบศึก`);
      chronicle(s, f.id, `สงบศึกกับ${t.name}`);
    } else {
      emit(ctx, [f.id], 'diplomacy', 'bad', `${t.name}ปฏิเสธการสงบศึก ทรัพย์ที่ส่งไปสูญเปล่า`);
    }
    return null;
  },

  proposePeace(ctx, f, a) {
    const s = ctx.s;
    const t = s.factions[a.target];
    if (!t || !t.alive || t.id === f.id || t.kind !== 'human') return 'INVALID_TARGET';
    const rel = relation(s, t.id, f.id);
    if (!rel.war) return 'NOT_AT_WAR';
    s.proposals = (s.proposals ?? []).filter(
      (p) => !(p.from === f.id && p.to === t.id && p.kind === 'peace'),
    );
    s.proposals.push({ id: newId(s, 'pr'), kind: 'peace', from: f.id, to: t.id, turn: s.turn });
    emit(ctx, [t.id], 'diplomacy', 'info', `🕊️ ${f.name}เสนอสงบศึก รอคำตอบ`);
    chronicle(s, f.id, `เสนอสงบศึกกับ${t.name}`);
    return null;
  },

  answerProposal(ctx, f, a, chapter) {
    const s = ctx.s;
    const proposals = s.proposals ?? [];
    const p = proposals.find((x) => x.id === a.proposalId && x.to === f.id);
    if (!p) return 'NOT_FOUND';
    s.proposals = proposals.filter((x) => x !== p);
    const other = s.factions[p.from];
    if (!other) return null;
    const what = p.kind === 'union' ? 'รวมแผ่นดิน' : 'สงบศึก';
    if (a.accept && other.alive && p.kind === 'union') {
      const rel = relation(s, f.id, p.from);
      const cost = scaleCost(chapter.costs.annex ?? {}, seasonOf(s.turn).diplo);
      if (rel.war || !canPay(other.res, cost)) {
        // conditions changed since it was proposed — void it rather than half-apply
        const why = rel.war ? 'ทั้งสองฝ่ายอยู่ในภาวะสงคราม' : `${other.name}มีทรัพย์ไม่พอจ่าย`;
        emit(ctx, [f.id, p.from], 'diplomacy', 'warn', `ข้อเสนอรวมแผ่นดินเป็นโมฆะ: ${why}`);
        return null;
      }
      pay(other.res, cost);
      f.ending = 'union';
      absorbFaction(ctx, other, f);
      chronicle(s, f.id, `ยอมรับข้อเสนอรวมแผ่นดินกับ${other.name}`);
      // the acceptor just left the game: if every remaining human had already ended the season,
      // nobody is left to trigger it — resolve it here instead of deadlocking
      const waiting = humanFactions(s).filter((h) => !s.ready.includes(h.id));
      if (humanFactions(s).length && !waiting.length) resolveSeason(ctx);
      return null;
    }
    if (a.accept && other.alive) {
      if (p.kind === 'peace') {
        const rel = relation(s, f.id, p.from);
        rel.war = false;
        rel.rel = chapter.rules.peaceRelation;
        // a mutual proposal the other way (they also offered peace) is now moot — drop it too.
        s.proposals = s.proposals.filter(
          (x) => !((x.from === f.id && x.to === p.from) || (x.from === p.from && x.to === f.id)),
        );
        emit(ctx, [f.id, p.from], 'diplomacy', 'good', `🕊️ ${f.name}และ${other.name}ตกลงสงบศึกกัน`);
        chronicle(s, f.id, `สงบศึกกับ${other.name}`);
      }
    } else {
      emit(ctx, [p.from], 'diplomacy', 'bad', `${f.name}ปฏิเสธข้อเสนอ${what}ของ${other.name}`);
      chronicle(s, f.id, `ปฏิเสธข้อเสนอ${what}จาก${other.name}`);
    }
    return null;
  },

  envoy(ctx, f, a) {
    return sendEnvoy(ctx, f, a.power);
  },

  answerDecision(ctx, f, a) {
    return answerDecision(ctx, f, a.decisionId, a.choice);
  },

  endTurn(ctx, f) {
    const s = ctx.s;
    s.ready.push(f.id);
    const waiting = humanFactions(s).filter((h) => !s.ready.includes(h.id));
    if (!waiting.length) resolveSeason(ctx);
    return null;
  },
};

function improveRelation(
  ctx: Ctx,
  f: Faction,
  target: FactionId,
  base: Parameters<typeof scaleCost>[0],
  gain: number,
  label: string,
  /** what a human target is told, e.g. "ส่งบรรณาการให้คุณ" */
  receivedLabel: string,
  giftToHuman: boolean,
): ActionError | null {
  const t = otherTarget(ctx.s, f, target);
  if (!t) return 'INVALID_TARGET';
  const rel = relation(ctx.s, t.id, f.id);
  if (rel.war) return 'AT_WAR';
  const cost = scaleCost(base, seasonOf(ctx.s.turn).diplo);
  if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
  pay(f.res, cost);
  rel.rel = clamp(rel.rel + gain, -100, 100);
  emit(ctx, [f.id], 'diplomacy', 'good', `${label}${t.name} ความสัมพันธ์ +${gain}`);
  if (t.kind === 'human') {
    if (giftToHuman) for (const k of Object.keys(cost) as (keyof typeof cost)[]) t.res[k] += cost[k] ?? 0;
    const gift = giftToHuman ? ` ได้รับ ${fmtCost(cost)}` : '';
    emit(ctx, [t.id], 'diplomacy', 'good', `${f.name}${receivedLabel}${gift} ความสัมพันธ์ +${gain}`);
  }
  return null;
}

const LOG_LIMIT = 300;

/**
 * The only way to change game state. Pure: never mutates `state`.
 * Server: run this for every client command and persist the result.
 * Client: run it optimistically for instant feedback.
 */
export function applyAction(state: GameState, factionId: FactionId, action: Action): ActionResult {
  if (state.ended) return fail('GAME_OVER');
  const f0 = state.factions[factionId];
  if (!f0 || f0.kind !== 'human') return fail('NOT_YOUR_FACTION');
  if (!f0.alive) return fail('FACTION_ELIMINATED');
  const handler = handlers[action?.type as Action['type']] as Handler<Action> | undefined;
  if (!handler) return fail('UNKNOWN_ACTION');
  if (state.ready.includes(factionId)) return fail('ALREADY_READY');
  if (
    action.type !== 'answerDecision' &&
    action.type !== 'answerProposal' &&
    state.pending.some((p) => p.faction === factionId)
  )
    return fail('PENDING_DECISION');

  const s = structuredClone(state);
  const ctx: Ctx = { s, ev: [] };
  const chapter = getChapterById(s.chapterId);
  const err = handler(ctx, s.factions[factionId]!, action, chapter);
  if (err) return fail(err);
  s.log.push(...ctx.ev);
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
  return { ok: true, state: s, events: ctx.ev };
}
