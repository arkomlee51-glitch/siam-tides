import { ENDINGS, RULES } from './data.js';
import { chronicle, citiesOf, emit, humanFactions } from './state.js';
import type { Ctx } from './state.js';
import type { EndingId, Faction, GameState } from './types.js';

export interface EndingProgress {
  shadow: { sovereignty: number; extremeTurns: number };
  empire: { captures: number; cityShare: number; cities: number; totalCities: number };
  river: { sovereignty: number; meter: number; cities: number; wealth: number };
  wisdom: { knowTotal: number; faithTotal: number; battles: number };
}

export function endingProgress(s: GameState, f: Faction): EndingProgress {
  const cities = citiesOf(s, f.id).length;
  const total = s.cities.length;
  return {
    shadow: { sovereignty: f.sovereignty, extremeTurns: f.extremeTurns },
    empire: { captures: f.stats.captures, cityShare: total ? cities / total : 0, cities, totalCities: total },
    river: { sovereignty: f.sovereignty, meter: f.meter, cities, wealth: f.res.wealth },
    wisdom: { knowTotal: f.knowTotal, faithTotal: f.faithTotal, battles: f.stats.battles },
  };
}

/** First match wins (see ENDING_ORDER). */
export function evaluateEnding(s: GameState, f: Faction): EndingId {
  if (!f.alive) return 'ashes';
  const p = endingProgress(s, f);
  if (p.shadow.sovereignty < 40 || p.shadow.extremeTurns >= RULES.extremeLimit) return 'shadow';
  if (p.empire.captures >= 3 && p.empire.cityShare >= 0.7) return 'empire';
  if (
    p.river.sovereignty >= 80 &&
    Math.abs(p.river.meter) <= RULES.balancedZone &&
    p.river.cities >= 3 &&
    p.river.wealth >= 100
  )
    return 'river';
  if (p.wisdom.knowTotal >= 150 && p.wisdom.faithTotal >= 120 && p.wisdom.battles <= 2) return 'wisdom';
  return 'survive';
}

export function finishGame(ctx: Ctx): void {
  const s = ctx.s;
  if (s.ended) return;
  s.ended = true;
  s.pending = [];
  s.proposals = [];
  s.ready = [];
  for (const f of Object.values(s.factions)) {
    if (f.kind !== 'human') continue;
    f.ending = f.ending ?? evaluateEnding(s, f);
    chronicle(s, f.id, `ตอนจบ: ${ENDINGS[f.ending].name}`);
  }
  emit(ctx, null, 'ending', 'info', 'จบรัชกาล');
}

export const allHumansGone = (s: GameState): boolean => humanFactions(s).length === 0;
