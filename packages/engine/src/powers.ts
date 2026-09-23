import { getChapterById } from './content/chapters/index.js';
import type { ChapterDefinition, DemandDefData } from './content/schema.js';
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

function shiftMeter(f: Faction, power: PowerId, amount: number, chapter: ChapterDefinition): void {
  f.meter = clamp(f.meter + chapter.foreignPowers[power]!.side * amount, -100, 100);
}

export function queueOffer(ctx: Ctx, f: Faction, power: PowerId): void {
  const chapter = getChapterById(ctx.s.chapterId);
  const P = chapter.foreignPowers[power]!;
  const demand = Math.floor(random(ctx.s) * chapter.demands.length);
  ctx.s.pending.push({ id: newId(ctx.s, 'd'), faction: f.id, power, kind: 'offer', demand });
  emit(ctx, [f.id], 'power', 'info', `${P.icon} ${P.name}ยื่นข้อเสนอ: ${chapter.demands[demand]!.title}`);
}

function queueUltimatum(ctx: Ctx, f: Faction, power: PowerId): void {
  const chapter = getChapterById(ctx.s.chapterId);
  const P = chapter.foreignPowers[power]!;
  ctx.s.pending.push({ id: newId(ctx.s, 'd'), faction: f.id, power, kind: 'ultimatum', demand: -1 });
  const U = chapter.flavor.ultimatum;
  emit(ctx, [f.id], 'power', 'bad', `${U.icon} ${U.arrivedLog.replace('{P}', P.name)}`);
}

export const negotiateCost = (s: GameState): Cost => {
  const chapter = getChapterById(s.chapterId);
  return scaleCost(chapter.costs.negotiate ?? {}, seasonOf(s.turn).diplo);
};

function applyOffer(
  ctx: Ctx,
  f: Faction,
  power: PowerId,
  d: DemandDefData,
  half: boolean,
  chapter: ChapterDefinition,
): void {
  const h = (v: number) => (half ? Math.round(v / 2) : v);
  const a = d.accept;
  if (a.wealth) f.res.wealth = Math.max(0, f.res.wealth + h(a.wealth));
  if (a.know) gainKnowledge(f, h(a.know));
  if (a.armyStr)
    for (const army of armiesOf(ctx.s, f.id))
      army.str = Math.min(chapter.rules.armyCap, army.str + h(a.armyStr));
  shiftMeter(f, power, h(a.meter), chapter);
  const P = chapter.foreignPowers[power]!;
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
  const chapter = getChapterById(s.chapterId);
  const d = s.pending.find((p) => p.id === decisionId && p.faction === f.id);
  if (!d) return 'NOT_FOUND';
  if (!choicesFor(d).includes(choice)) return 'INVALID_CHOICE';
  const P = chapter.foreignPowers[d.power]!;
  const pw = f.powers[d.power];
  if (d.kind === 'offer') {
    const demand = chapter.demands[d.demand]!;
    if (choice === 'negotiate') {
      const cost = negotiateCost(s);
      if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
      pay(f.res, cost);
    }
    s.pending = s.pending.filter((p) => p !== d);
    if (choice === 'accept') applyOffer(ctx, f, d.power, demand, false, chapter);
    else if (choice === 'negotiate') applyOffer(ctx, f, d.power, demand, true, chapter);
    else {
      pw.patience--;
      shiftMeter(f, d.power, -6, chapter);
      f.stats.declined++;
      emit(ctx, [f.id], 'power', 'warn', `ปฏิเสธข้อเสนอของ${P.name}`);
      if (pw.patience <= 0) queueUltimatum(ctx, f, d.power);
    }
    return null;
  }
  if (choice === 'pay') {
    const cost = chapter.costs.ultimatum ?? {};
    if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
    pay(f.res, cost);
    pw.patience = 2;
    emit(ctx, [f.id], 'power', 'warn', `จ่ายค่าชดเชยให้${P.name}`);
    chronicle(s, f.id, chapter.flavor.ultimatum.paidChronicle.replace('{P}', P.name));
  } else {
    f.sovereignty = clamp(f.sovereignty - 15, 0, 100);
    shiftMeter(f, d.power, 30, chapter);
    pw.patience = 3;
    emit(ctx, [f.id], 'power', 'bad', `ยอมตามคำขาดของ${P.name} เอกราช −15`);
    chronicle(s, f.id, `ยอมตามคำขาดของ${P.name}`);
  }
  s.pending = s.pending.filter((p) => p !== d);
  return null;
}

export function sendEnvoy(ctx: Ctx, f: Faction, power: PowerId): ActionError | null {
  const chapter = getChapterById(ctx.s.chapterId);
  if (!chapter.foreignPowers[power]) return 'INVALID_TARGET';
  const cost = scaleCost(chapter.costs.envoy ?? {}, seasonOf(ctx.s.turn).diplo);
  if (!canPay(f.res, cost)) return 'INSUFFICIENT_RESOURCES';
  pay(f.res, cost);
  shiftMeter(f, power, chapter.rules.envoyMeter, chapter);
  f.powers[power].patience = Math.min(4, f.powers[power].patience + 1);
  gainKnowledge(f, chapter.rules.envoyKnow);
  emit(
    ctx,
    [f.id],
    'power',
    'good',
    `ส่งคณะทูตไป${chapter.foreignPowers[power]!.name} ได้ความรู้ +${chapter.rules.envoyKnow}`,
  );
  return null;
}

/**
 * Which power sends an offer in a given year — cycles through the chapter's
 * registered foreign powers in declaration order (not hard-coded to any 2 specific
 * ids; see docs/adr/0007 Addendum 5). For today's 2-power chapter this reproduces the
 * original odd/even-year alternation exactly.
 */
export function offeringPower(chapter: ChapterDefinition, year: number): PowerId {
  const ids = Object.keys(chapter.foreignPowers) as PowerId[];
  if (ids.length === 0) throw new Error(`chapter '${chapter.manifest.id}' has no foreign powers`);
  return ids[(year - 1) % ids.length]!;
}
