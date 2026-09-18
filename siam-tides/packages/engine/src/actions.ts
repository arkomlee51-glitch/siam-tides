import { BUILDINGS, COSTS, NEW_CITY_NAMES, RULES } from './data.js';
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
  const t = terrainAt(a.c, a.r);
  if (!t || t === 'M') return 'ตั้งเมืองบนเทือกเขาไม่ได้';
  if (cityAt(s, a.c, a.r)) return 'ช่องนี้มีเมืองอยู่แล้ว';
  if (s.cities.some((c) => hexDistance([c.c, c.r], [a.c, a.r]) < RULES.cityMinDistance))
    return `ต้องห่างจากเมืองอื่นอย่างน้อย ${RULES.cityMinDistance} ช่อง`;
  return null;
}

function aiTarget(s: GameState, target: FactionId): Faction | null {
  const t = s.factions[target];
  return t && t.kind === 'ai' && t.alive ? t : null;
}

type Handler<A extends Action> = (ctx: Ctx, f: Faction, a: A) => ActionError | null;
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

  found(ctx, f, a) {
    const s = ctx.s;
    const army = ownArmy(s, f, a.armyId);
    if (typeof army === 'string') return army;
    if (foundBlocker(s, army)) return 'INVALID_LOCATION';
    const cost = scaleCost(COSTS.found, seasonOf(s.turn).build);
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, cost);
    const name = NEW_CITY_NAMES[s.cityNameIdx++ % NEW_CITY_NAMES.length]!;
    s.cities.push({
      id: newId(s, 'c'),
      name,
      c: army.c,
      r: army.r,
      owner: f.id,
      capital: false,
      buildings: [],
      garrison: RULES.newCityGarrison,
      baseGarrison: RULES.newCityBaseGarrison,
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

  build(ctx, f, a) {
    const city = ctx.s.cities.find((c) => c.id === a.cityId);
    if (!city) return 'NOT_FOUND';
    if (city.owner !== f.id) return 'NOT_OWNER';
    const def = BUILDINGS[a.building];
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

  recruit(ctx, f, a) {
    const s = ctx.s;
    const city = s.cities.find((c) => c.id === a.cityId);
    if (!city) return 'NOT_FOUND';
    if (city.owner !== f.id) return 'NOT_OWNER';
    const here = armyAt(s, city.c, city.r);
    if (here && here.str >= RULES.armyCap) return 'ARMY_FULL';
    const cost = scaleCost(COSTS.recruit, seasonOf(s.turn).recruit);
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, cost);
    if (here) {
      here.str = Math.min(RULES.armyCap, here.str + RULES.recruitReinforce);
      emit(ctx, [f.id], 'army', 'good', `เสริมกำลังทัพที่${city.name} +${RULES.recruitReinforce}`);
    } else {
      s.armies.push({
        id: newId(s, 'a'),
        owner: f.id,
        c: city.c,
        r: city.r,
        str: RULES.recruitNew,
        morale: 70,
        mp: 0,
        moved: true,
      });
      emit(ctx, [f.id], 'army', 'good', `เกณฑ์ทัพใหม่ที่${city.name} เดินได้ฤดูหน้า`);
    }
    return null;
  },

  tribute(ctx, f, a) {
    return improveRelation(ctx, f, a.target, COSTS.tribute, RULES.tributeGain, 'ส่งบรรณาการ');
  },

  festival(ctx, f, a) {
    return improveRelation(ctx, f, a.target, COSTS.festival, RULES.festivalGain, 'จัดงานบุญร่วมกับ');
  },

  annex(ctx, f, a) {
    const s = ctx.s;
    const t = aiTarget(s, a.target);
    if (!t) return 'INVALID_TARGET';
    const rel = relation(s, t.id, f.id);
    if (rel.war) return 'AT_WAR';
    if (rel.rel < RULES.annexThreshold) return 'RELATION_TOO_LOW';
    const cost = scaleCost(COSTS.annex, seasonOf(s.turn).diplo);
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, cost);
    for (const c of s.cities) if (c.owner === t.id) Object.assign(c, { owner: f.id, capital: false });
    for (const army of s.armies)
      if (army.owner === t.id) Object.assign(army, { owner: f.id, mp: 0, moved: true });
    t.alive = false;
    for (const other of Object.values(s.factions))
      if (other.id !== t.id) relation(s, other.id, t.id).war = false;
    f.stats.annexed++;
    f.stability = clamp(f.stability + 5, 0, 100);
    emit(ctx, null, 'diplomacy', 'good', `🤝 ${t.name}เข้าร่วมกับ${f.name}โดยสันติ`);
    chronicle(s, f.id, `${t.name}เข้าร่วมแผ่นดินโดยสันติ`);
    return null;
  },

  declareWar(ctx, f, a) {
    const s = ctx.s;
    const t = s.factions[a.target];
    if (!t || !t.alive || t.id === f.id) return 'INVALID_TARGET';
    const rel = relation(s, t.id, f.id);
    if (rel.war) return 'AT_WAR';
    rel.war = true;
    rel.rel = Math.min(rel.rel, RULES.warRelationCap);
    f.stability = clamp(f.stability - 5, 0, 100);
    for (const ai of aiFactions(s)) {
      if (ai.id === t.id) continue;
      const r = relation(s, ai.id, f.id);
      if (!r.war) r.rel -= 5;
    }
    const audience = t.kind === 'human' ? [f.id, t.id] : [f.id];
    emit(ctx, audience, 'diplomacy', 'bad', `⚔️ ${f.name}ประกาศสงครามกับ${t.name}`);
    chronicle(s, f.id, `ประกาศสงครามกับ${t.name}`);
    return null;
  },

  offerPeace(ctx, f, a) {
    const s = ctx.s;
    const t = aiTarget(s, a.target);
    // Human-to-human peace needs a proposal/accept flow (Phase 5).
    if (!t) return 'INVALID_TARGET';
    const rel = relation(s, t.id, f.id);
    if (!rel.war) return 'NOT_AT_WAR';
    const cost = scaleCost(COSTS.peace, seasonOf(s.turn).diplo);
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, cost);
    if (chance(s, RULES.peaceChance)) {
      rel.war = false;
      rel.rel = RULES.peaceRelation;
      emit(ctx, [f.id], 'diplomacy', 'good', `🕊️ ${t.name}ยอมสงบศึก`);
      chronicle(s, f.id, `สงบศึกกับ${t.name}`);
    } else {
      emit(ctx, [f.id], 'diplomacy', 'bad', `${t.name}ปฏิเสธการสงบศึก ทรัพย์ที่ส่งไปสูญเปล่า`);
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
): ActionError | null {
  const t = aiTarget(ctx.s, target);
  if (!t) return 'INVALID_TARGET';
  const rel = relation(ctx.s, t.id, f.id);
  if (rel.war) return 'AT_WAR';
  const cost = scaleCost(base, seasonOf(ctx.s.turn).diplo);
  if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
  pay(f.res, cost);
  rel.rel = clamp(rel.rel + gain, -100, 100);
  emit(ctx, [f.id], 'diplomacy', 'good', `${label}${t.name} ความสัมพันธ์ +${gain}`);
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
  if (action.type !== 'answerDecision' && state.pending.some((p) => p.faction === factionId))
    return fail('PENDING_DECISION');

  const s = structuredClone(state);
  const ctx: Ctx = { s, ev: [] };
  const err = handler(ctx, s.factions[factionId]!, action);
  if (err) return fail(err);
  s.log.push(...ctx.ev);
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
  return { ok: true, state: s, events: ctx.ev };
}
