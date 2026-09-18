import { COSTS, DEMANDS, POWERS, RULES } from './data.js';
import type { DemandDef } from './data.js';
import { canPay, gainKnowledge, pay, scaleCost } from './economy.js';
import { random } from './rng.js';
import { armiesOf, chronicle, clamp, emit, newId, seasonOf } from './state.js';
import type { Ctx } from './state.js';
import type {
  ActionError,
  Cost,
  DecisionChoice,
  Faction,
  GameState,
  PendingDecision,
  PowerId,
} from './types.js';

const shiftMeter = (f: Faction, power: PowerId, amount: number): void => {
  f.meter = clamp(f.meter + POWERS[power].side * amount, -100, 100);
};

export function queueOffer(ctx: Ctx, f: Faction, power: PowerId): void {
  const demand = Math.floor(random(ctx.s) * DEMANDS.length);
  ctx.s.pending.push({ id: newId(ctx.s, 'd'), faction: f.id, power, kind: 'offer', demand });
  emit(
    ctx,
    [f.id],
    'power',
    'info',
    `${POWERS[power].icon} ${POWERS[power].name}ยื่นข้อเสนอ: ${DEMANDS[demand]!.title}`,
  );
}

function queueUltimatum(ctx: Ctx, f: Faction, power: PowerId): void {
  ctx.s.pending.push({ id: newId(ctx.s, 'd'), faction: f.id, power, kind: 'ultimatum', demand: -1 });
  emit(ctx, [f.id], 'power', 'bad', `⚓ เรือปืนของ${POWERS[power].name}ปิดปากแม่น้ำ`);
}

export const negotiateCost = (s: GameState): Cost => scaleCost(COSTS.negotiate, seasonOf(s.turn).diplo);

function applyOffer(ctx: Ctx, f: Faction, power: PowerId, d: DemandDef, half: boolean): void {
  const h = (v: number) => (half ? Math.round(v / 2) : v);
  const a = d.accept;
  if (a.wealth) f.res.wealth = Math.max(0, f.res.wealth + h(a.wealth));
  if (a.know) gainKnowledge(f, h(a.know));
  if (a.armyStr)
    for (const army of armiesOf(ctx.s, f.id)) army.str = Math.min(RULES.armyCap, army.str + h(a.armyStr));
  shiftMeter(f, power, h(a.meter));
  const P = POWERS[power];
  if (half) {
    f.stats.negotiated++;
    emit(ctx, [f.id], 'power', 'good', `ต่อรองกับ${P.name}สำเร็จ ได้ประโยชน์บางส่วนโดยไม่เสียเอกราช`);
    return;
  }
  f.sovereignty = clamp(f.sovereignty + (a.sov ?? 0), 0, 100);
  f.powers[power].patience = Math.min(4, f.powers[power].patience + 1);
  f.stats.accepted++;
  emit(ctx, [f.id], 'power', 'info', `ยอมรับข้อเสนอของ${P.name}`);
  chronicle(ctx.s, f.id, `ยอมรับข้อเสนอของ${P.name}`);
}

const OFFER_CHOICES: readonly DecisionChoice[] = ['accept', 'negotiate', 'decline'];
const ULTIMATUM_CHOICES: readonly DecisionChoice[] = ['pay', 'yield'];
export const choicesFor = (d: PendingDecision): readonly DecisionChoice[] =>
  d.kind === 'offer' ? OFFER_CHOICES : ULTIMATUM_CHOICES;

export function answerDecision(
  ctx: Ctx,
  f: Faction,
  decisionId: string,
  choice: DecisionChoice,
): ActionError | null {
  const s = ctx.s;
  const d = s.pending.find((p) => p.id === decisionId && p.faction === f.id);
  if (!d) return 'NOT_FOUND';
  if (!choicesFor(d).includes(choice)) return 'INVALID_CHOICE';
  const P = POWERS[d.power];
  const pw = f.powers[d.power];
  if (d.kind === 'offer') {
    const demand = DEMANDS[d.demand]!;
    if (choice === 'negotiate') {
      const cost = negotiateCost(s);
      if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
      pay(f.res, cost);
    }
    s.pending = s.pending.filter((p) => p !== d);
    if (choice === 'accept') applyOffer(ctx, f, d.power, demand, false);
    else if (choice === 'negotiate') applyOffer(ctx, f, d.power, demand, true);
    else {
      pw.patience--;
      shiftMeter(f, d.power, -6);
      f.stats.declined++;
      emit(ctx, [f.id], 'power', 'warn', `ปฏิเสธข้อเสนอของ${P.name}`);
      if (pw.patience <= 0) queueUltimatum(ctx, f, d.power);
    }
    return null;
  }
  if (choice === 'pay') {
    if (!canPay(f.res, COSTS.ultimatum)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, COSTS.ultimatum);
    pw.patience = 2;
    emit(ctx, [f.id], 'power', 'warn', `จ่ายค่าชดเชยให้${P.name}`);
    chronicle(s, f.id, 'จ่ายค่าชดเชยเพื่อคลี่คลายวิกฤตเรือปืน');
  } else {
    f.sovereignty = clamp(f.sovereignty - 15, 0, 100);
    shiftMeter(f, d.power, 30);
    pw.patience = 3;
    emit(ctx, [f.id], 'power', 'bad', `ยอมตามคำขาดของ${P.name} เอกราช −15`);
    chronicle(s, f.id, `ยอมตามคำขาดของ${P.name}`);
  }
  s.pending = s.pending.filter((p) => p !== d);
  return null;
}

export function sendEnvoy(ctx: Ctx, f: Faction, power: PowerId): ActionError | null {
  if (!POWERS[power]) return 'INVALID_TARGET';
  const cost = scaleCost(COSTS.envoy, seasonOf(ctx.s.turn).diplo);
  if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
  pay(f.res, cost);
  shiftMeter(f, power, RULES.envoyMeter);
  f.powers[power].patience = Math.min(4, f.powers[power].patience + 1);
  gainKnowledge(f, RULES.envoyKnow);
  emit(ctx, [f.id], 'power', 'good', `ส่งคณะทูตไป${POWERS[power].name} ได้ความรู้ +${RULES.envoyKnow}`);
  return null;
}

/** Which power sends offers in a given year (alternates). */
export const offeringPower = (year: number): PowerId => (year % 2 === 1 ? 'lion' : 'eagle');
