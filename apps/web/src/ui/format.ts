import { getChapterById, scaleCost, seasonOf } from '@siam/engine';
import type { ChapterDefinition, Cost, GameState, ResourceId } from '@siam/engine';

export const RES_ORDER: ResourceId[] = ['rice', 'man', 'wealth', 'faith', 'know'];

/**
 * The content of the chapter this game was built from — same registry lookup the engine
 * uses, so what the UI shows (costs, names, rules) always matches what the engine
 * actually applies (docs/adr/0007 Addendum 7).
 */
export const chapterOf = (state: GameState): ChapterDefinition => getChapterById(state.chapterId);

export const costText = (cost: Cost, chapter: ChapterDefinition): string =>
  RES_ORDER.filter((k) => cost[k] !== undefined)
    .map((k) => `${chapter.resourceLabels[k].icon}${cost[k]}`)
    .join(' ');

export const seasonalCostOf = (state: GameState, base: Cost, kind: 'build' | 'diplo' | 'recruit'): Cost =>
  scaleCost(base, seasonOf(state.turn)[kind]);

export const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));
