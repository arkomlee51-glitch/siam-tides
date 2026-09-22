import { earlyRattanakosinChapter } from './early-rattanakosin.js';
import type { ChapterDefinition } from '../schema.js';

/**
 * Registry of every chapter the engine knows about, keyed by `manifest.id`.
 *
 * `GameState` stores only `chapterId: string` (not the full `ChapterDefinition`) so
 * that a game snapshot sent over the wire or persisted to Supabase doesn't carry a
 * whole chapter's map/buildings/perks payload on every turn — the same reason
 * `data.ts`'s constants were never embedded in `GameState` either. Pure functions that
 * need chapter content (`computeIncome`, `checkPerks`, `resolveBattle`, ...) look it up
 * here via `getChapterById(s.chapterId)`.
 */
export const CHAPTERS: Record<string, ChapterDefinition> = {
  [earlyRattanakosinChapter.manifest.id]: earlyRattanakosinChapter,
};

/**
 * Throws if `id` isn't registered — a `GameState` should never reference an unknown
 * chapter (either a bug in `createGame`, or a chapter that was removed from the
 * registry after games referencing it were created).
 */
export function getChapterById(id: string): ChapterDefinition {
  const chapter = CHAPTERS[id];
  if (!chapter) throw new Error(`unknown chapter id: ${id}`);
  return chapter;
}
