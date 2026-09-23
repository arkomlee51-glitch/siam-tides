import type { GameState } from '../types.js';
import { CHAPTERS } from './chapters/index.js';
import type { CoreResourceId, ResourceAmounts } from './schema.js';

/**
 * Legacy system (Phase 6): small, capped bonuses one finished chapter can hand a
 * player going into their next chapter. See docs/adr/0007 for the full design
 * rationale. Kept deliberately generic — it only ever touches the five core
 * resources plus starting stability/army strength/relations, never a
 * chapter-specific building or perk id, so a bonus earned in chapter 2 still makes
 * sense in chapter 5 without any chapter having to know about any other chapter.
 */

export type LegacyCategory =
  'infrastructure' | 'prosperity' | 'culture' | 'knowledge' | 'military' | 'diplomacy';

export const LEGACY_CATEGORIES: readonly LegacyCategory[] = [
  'infrastructure',
  'prosperity',
  'culture',
  'knowledge',
  'military',
  'diplomacy',
];

/**
 * Max combined bonus per category, as a fraction (0.15 = +15%). Deliberately capped
 * well under what a single dominant chapter-1 playthrough could otherwise rack up —
 * the point of a cap is that stacking five perfect chapters is barely stronger than
 * stacking two, so chapter 6 stays winnable by someone who had one rough chapter.
 */
export const LEGACY_CAPS: Record<LegacyCategory, number> = {
  infrastructure: 0.15,
  prosperity: 0.15,
  culture: 0.15,
  knowledge: 0.15,
  military: 0.1,
  diplomacy: 0.1,
};

/** Thai label per category, shared by the notes below and the web UI. */
export const LEGACY_LABELS: Record<LegacyCategory, string> = {
  infrastructure: 'โครงสร้างพื้นฐาน (ผลผลิตข้าว)',
  prosperity: 'ความมั่งคั่ง (ผลผลิตทรัพย์)',
  culture: 'วัฒนธรรม (ผลผลิตศรัทธา + เสถียรภาพเริ่มต้น)',
  knowledge: 'ภูมิปัญญา (ผลผลิตความรู้)',
  military: 'การทหาร (กำลังทัพเริ่มต้น)',
  diplomacy: 'การทูต (ความสัมพันธ์เริ่มต้นกับแคว้นอื่น)',
};

/**
 * Sanitises Legacy totals coming from outside the engine (the server reads them from
 * Postgres): every category present, finite, and within `[0, LEGACY_CAPS[c]]`. The
 * caps are the whole point of the system, so the engine enforces them itself rather
 * than trusting stored data.
 */
export function clampLegacyTotals(
  input: Partial<Record<LegacyCategory, number>>,
): Record<LegacyCategory, number> {
  const out = Object.fromEntries(LEGACY_CATEGORIES.map((c) => [c, 0])) as Record<LegacyCategory, number>;
  for (const c of LEGACY_CATEGORIES) {
    const v = input[c];
    out[c] = typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), LEGACY_CAPS[c]) : 0;
  }
  return out;
}

/** Which core resource (or faction stat) each category's bonus is expressed against. */
const CATEGORY_TARGET: Record<LegacyCategory, CoreResourceId | 'stability' | 'armyStr' | 'relation'> = {
  infrastructure: 'rice',
  prosperity: 'wealth',
  culture: 'faith',
  knowledge: 'know',
  military: 'armyStr',
  diplomacy: 'relation',
};

export interface LegacyBonus {
  category: LegacyCategory;
  /** fraction, already clamped to `LEGACY_CAPS[category]` */
  amount: number;
  sourceChapterId: string;
  /** Thai, one line, shown to the player at the start of their next chapter */
  note: string;
}

/** Diminishing-returns curve so bonus contributions never need clamping mid-sum. */
function diminish(raw: number, k: number): number {
  if (raw <= 0) return 0;
  return 1 - Math.exp(-raw / k);
}

/**
 * Reads one human faction's final state at the end of a chapter and produces the
 * Legacy bonuses they carry forward. Pure — same input always produces the same
 * output, same as the rest of the engine, so it replays deterministically.
 */
export function computeLegacyBonuses(state: GameState, chapterId: string, factionId: string): LegacyBonus[] {
  const f = state.factions[factionId];
  if (!f) return [];

  const citiesHeld = state.cities.filter((c) => c.owner === factionId).length;
  const chapterName = CHAPTERS[chapterId]?.manifest.name ?? chapterId;
  const raw: Record<LegacyCategory, number> = {
    infrastructure: citiesHeld * 0.08,
    prosperity: f.res.wealth / 200,
    culture: f.faithTotal / 150,
    knowledge: f.knowTotal / 150,
    military: f.stats.wins * 0.1,
    diplomacy: f.stats.negotiated * 0.15 + f.stats.accepted * 0.1,
  };

  const notes: Record<LegacyCategory, string> = {
    infrastructure: `สืบทอดจากบท${chapterName}: โครงสร้างพื้นฐาน ${citiesHeld} เมืองที่เหลืออยู่`,
    prosperity: `สืบทอดจากบท${chapterName}: คลังทรัพย์ที่สั่งสมไว้`,
    culture: `สืบทอดจากบท${chapterName}: ศรัทธาที่ประชาชนสั่งสม`,
    knowledge: `สืบทอดจากบท${chapterName}: ตำราและภูมิปัญญาที่ถ่ายทอดมา`,
    military: `สืบทอดจากบท${chapterName}: ประสบการณ์รบจากสงคราม ${f.stats.wins} ครั้งที่ชนะ`,
    diplomacy: `สืบทอดจากบท${chapterName}: สายสัมพันธ์ทางการทูตที่วางไว้`,
  };

  const bonuses: LegacyBonus[] = [];
  for (const category of LEGACY_CATEGORIES) {
    const cap = LEGACY_CAPS[category];
    const amount = diminish(raw[category], 4) * cap;
    if (amount <= 0.001) continue;
    bonuses.push({ category, amount, sourceChapterId: chapterId, note: notes[category] });
  }
  return bonuses;
}

/** Sums same-category bonuses from multiple past chapters, still respecting the cap. */
export function mergeLegacyBonuses(bonuses: readonly LegacyBonus[]): Record<LegacyCategory, number> {
  const totals = Object.fromEntries(LEGACY_CATEGORIES.map((c) => [c, 0])) as Record<LegacyCategory, number>;
  for (const b of bonuses) totals[b.category] += b.amount;
  for (const c of LEGACY_CATEGORIES) totals[c] = Math.min(totals[c], LEGACY_CAPS[c]);
  return totals;
}

export interface LegacyStartAdjustment {
  /** multiplicative, e.g. 1.08 = cityBaseYield.rice ×1.08 for this faction only */
  cityYieldMultiplier: Partial<Record<CoreResourceId, number>>;
  /** additive, applied to the faction's starting resource pool */
  startResourceBonus: Partial<ResourceAmounts>;
  /** additive stability at game start */
  stabilityBonus: number;
  /** multiplicative on the faction's starting army strength */
  armyStrMultiplier: number;
  /** additive starting relation toward AI factions/foreign powers */
  relationBonus: number;
}

/**
 * Turns a player's merged Legacy totals into concrete, generic start-of-game
 * adjustments. Never touches a chapter-specific building/perk id — only the shared
 * chassis fields every chapter has (resources, stability, army strength, relations)
 * — so this function needs no knowledge of which of the six chapters is starting.
 */
export function applyLegacyBonuses(totals: Record<LegacyCategory, number>): LegacyStartAdjustment {
  const adj: LegacyStartAdjustment = {
    cityYieldMultiplier: {},
    startResourceBonus: {},
    stabilityBonus: 0,
    armyStrMultiplier: 1,
    relationBonus: 0,
  };

  for (const category of LEGACY_CATEGORIES) {
    const amount = totals[category] ?? 0;
    if (amount <= 0) continue;
    const target = CATEGORY_TARGET[category];
    if (target === 'stability') {
      adj.stabilityBonus += Math.round(amount * 20);
    } else if (target === 'armyStr') {
      adj.armyStrMultiplier += amount;
    } else if (target === 'relation') {
      adj.relationBonus += Math.round(amount * 30);
    } else {
      adj.cityYieldMultiplier[target] = 1 + amount;
    }
  }
  // culture also nudges starting stability a little, on top of feeding `faith` yield —
  // a stable state is as much what "culture carried forward" should mean as temple output is.
  if (totals.culture > 0) adj.stabilityBonus += Math.round(totals.culture * 10);

  return adj;
}
