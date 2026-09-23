import type { Coord } from '../types.js';

/**
 * Data-driven "chapter" content schema (Phase 6).
 *
 * The engine's chassis (hex movement, seasons, armies, cities, combat, diplomacy,
 * Chronicle) is chapter-agnostic. Everything a chapter can vary — its map, terrain
 * flavor, buildings, perks, foreign powers, demands, and endings — lives in a
 * `ChapterDefinition` validated by `validateChapterDefinition()` below rather than
 * hard-coded TypeScript literal unions.
 *
 * Resource IDs are the one exception: they are NOT chapter-data, they are the fixed
 * `CORE_RESOURCE_IDS` chassis constant. See docs/adr/0007 for why (Legacy bonuses need
 * a shared unit to carry across chapters without a conversion table).
 *
 * NOTE: this schema is not wired into `createGame`/`economy`/`turn`/`ai` yet — those
 * still read the hard-coded `data.ts` for the one chapter that ships today. Rewiring
 * every engine module to take a `ChapterDefinition` parameter is future work (see
 * ADR-0007 "Not done"). This file — plus `chapters/*.ts` porting the existing content
 * into the shape — exists to prove the schema can represent real, shipped content
 * before any engine rewiring is attempted.
 */

/** The five resource concepts every chapter shares. Fixed on purpose — see module doc. */
export const CORE_RESOURCE_IDS = ['rice', 'man', 'wealth', 'faith', 'know'] as const;
export type CoreResourceId = (typeof CORE_RESOURCE_IDS)[number];
export type ResourceAmounts = Record<CoreResourceId, number>;
export type PartialResourceAmounts = Partial<ResourceAmounts>;

export interface ChapterManifest {
  /** stable slug, e.g. 'early-rattanakosin'. Never reused across chapters. */
  id: string;
  /** 1..6 — position in the six-chapter campaign (docs/ROADMAP.md เฟส 6) */
  order: number;
  /** Thai display name, e.g. "ต้นรัตนโกสินทร์" */
  name: string;
  /** short era label shown in the chapter picker, e.g. "รัชกาลที่ 3–5" */
  era: string;
  /** rough real-world date range, for Timeline Replay, e.g. "พ.ศ. 2367–2453" */
  yearsLabel: string;
  /** one-paragraph blurb */
  summary: string;
}

export interface ResourceLabel {
  name: string;
  icon: string;
}

export interface TerrainDefData {
  id: string;
  name: string;
  short: string;
  cost: number;
  def: number;
  yield: PartialResourceAmounts;
  /** seasonal-disaster ids this terrain is exposed to, e.g. `['flood']` — see turn.ts */
  disasterExposure?: readonly string[];
}

export interface SeasonDefData {
  id: string;
  name: string;
  icon: string;
  move: number;
  atk: number;
  build: number;
  diplo: number;
  recruit: number;
  rice: number;
  man: number;
  tip: string;
}

/**
 * What a building does beyond its base `yield`, as data — same "effect declared as
 * data, applied generically" pattern as `PerkEffect` (see docs/adr/0007 Addendum 5).
 * `disaster` is a free-form id (e.g. `'flood'`) matched against a terrain's
 * `disasterExposure` and a seasonal event's own disaster id in `turn.ts` — not an
 * enum, so a future chapter can introduce disasters this one never had.
 */
export type BuildingEffect =
  | { kind: 'stabilityPerCity'; amount: number }
  | { kind: 'disasterLossReduction'; disaster: string; reducedLoss: number };

export interface BuildingDefData {
  id: string;
  name: string;
  desc: string;
  cost: PartialResourceAmounts;
  yield: PartialResourceAmounts;
  coastalOnly?: boolean;
  garrisonBonus?: number;
  /** narrative/mechanical effects beyond base yield — see `BuildingEffect` doc comment */
  effects?: readonly BuildingEffect[];
}

/**
 * What a perk actually DOES, as data — not a hard-coded string-id check in economy.ts/
 * combat.ts. See docs/adr/0007 Addendum 4. A perk can carry more than one effect (e.g.
 * a "renaissance" perk could boost both know and faith at once); each effect kind is
 * applied generically by every chapter, since all six chapters share identical
 * mechanics and differ only in flavor (names/desc/numbers), per the product decision
 * in ADR-0007 Addendum 4.
 */
export type PerkEffect =
  | { kind: 'resourceMultiplier'; resource: CoreResourceId; multiplier: number }
  | { kind: 'combatMultiplier'; multiplier: number };

export interface PerkDefData {
  id: string;
  /** knowledge threshold that unlocks it */
  at: number;
  name: string;
  desc: string;
  /** what it does, applied generically — see `PerkEffect` doc comment */
  effects: readonly PerkEffect[];
}

export interface ForeignPowerDefData {
  id: string;
  name: string;
  icon: string;
  /** which end of the bamboo-diplomacy meter this power pulls toward */
  side: -1 | 1;
}

export interface DemandDefData {
  title: string;
  /** `{P}` is replaced with the power's name */
  text: string;
  accept: { wealth?: number; know?: number; armyStr?: number; meter: number; sov?: number };
}

export interface EndingDefData {
  id: string;
  icon: string;
  name: string;
  cond: string;
  text: string;
}

export interface SeatDefData {
  id: string;
  factionName: string;
  colorToken: string;
  city: { name: string; c: number; r: number; buildings: string[]; aiGarrison: number };
  army: { c: number; r: number; aiStr: number; humanStr: number };
  aiRelation: number;
}

/** Same tunables as `RULES` in data.ts, but per-chapter instead of a single global const. */
export interface ChapterRulesData {
  maxTurn: number;
  cityMinDistance: number;
  armyCap: number;
  recruitNew: number;
  recruitReinforce: number;
  upkeepPerStr: number;
  cityBaseYield: ResourceAmounts;
  riverBonus: PartialResourceAmounts;
  coastalWealth: number;
  cityDefense: number;
  wallsDefense: number;
  capitalDefense: number;
  humanCapitalGarrison: number;
  newCityGarrison: number;
  newCityBaseGarrison: number;
  capturedGarrison: number;
  capturedBaseGarrison: number;
  tributeGain: number;
  festivalGain: number;
  annexThreshold: number;
  peaceChance: number;
  peaceRelation: number;
  warRelationCap: number;
  envoyMeter: number;
  envoyKnow: number;
  balancedZone: number;
  dangerZone: number;
  extremeLimit: number;
  balancedKnowBonus: number;
  aiWarThreshold: number;
  aiWarChance: number;
  aiPeaceStrCap: number;
  aiWarStrCap: number;
  aiRecruitCooldown: number;
  aiRecruitStr: number;
  aiWeakStr: number;
  expansionIrritation: number;
  startResources: ResourceAmounts;
  startStability: number;
}

export interface ChapterDefinition {
  manifest: ChapterManifest;
  map: readonly string[];
  river: readonly Coord[];
  terrain: Record<string, TerrainDefData>;
  /** which terrain ids actually appear in `map`, in the same order data.ts hard-codes them */
  terrainOrder: readonly string[];
  seasons: readonly SeasonDefData[];
  /** per-chapter display label for each fixed core resource (name/icon can vary; the id set cannot) */
  resourceLabels: Record<CoreResourceId, ResourceLabel>;
  buildings: Record<string, BuildingDefData>;
  costs: Record<string, PartialResourceAmounts>;
  rules: ChapterRulesData;
  perks: readonly PerkDefData[];
  foreignPowers: Record<string, ForeignPowerDefData>;
  demands: readonly DemandDefData[];
  endings: Record<string, EndingDefData>;
  /** evaluated top to bottom — first match wins */
  endingOrder: readonly string[];
  /** join order = seat order; humans fill seats first, the rest are AI */
  seats: readonly SeatDefData[];
  /** name pool `found` draws from, cycling in order (see actions.ts) */
  newCityNames: readonly string[];
}

export class ChapterValidationError extends Error {
  constructor(chapterId: string, issues: string[]) {
    super(`chapter '${chapterId}' failed validation:\n- ${issues.join('\n- ')}`);
    this.name = 'ChapterValidationError';
  }
}

/**
 * Structural + referential validation only (not a balance checker). Throws
 * `ChapterValidationError` listing every problem found, not just the first —
 * a content author fixing a new chapter wants the whole list at once.
 */
export function validateChapterDefinition(def: ChapterDefinition): void {
  const issues: string[] = [];
  const id = def.manifest?.id ?? '(unknown)';

  if (!def.manifest?.id) issues.push('manifest.id is required');
  if (!Number.isInteger(def.manifest?.order) || def.manifest.order < 1 || def.manifest.order > 6) {
    issues.push('manifest.order must be an integer 1..6');
  }

  for (const resId of CORE_RESOURCE_IDS) {
    if (!def.resourceLabels?.[resId]) issues.push(`resourceLabels.${resId} is required`);
  }

  if (!def.map?.length) issues.push('map must have at least one row');
  const mapWidth = def.map?.[0]?.length ?? 0;
  def.map?.forEach((row, i) => {
    if (row.length !== mapWidth) issues.push(`map row ${i} has length ${row.length}, expected ${mapWidth}`);
  });

  const terrainIds = new Set(Object.keys(def.terrain ?? {}));
  for (const t of def.terrainOrder ?? []) {
    if (!terrainIds.has(t)) issues.push(`terrainOrder references unknown terrain '${t}'`);
  }
  const usedGlyphs = new Set<string>();
  for (const row of def.map ?? []) for (const ch of row) usedGlyphs.add(ch);
  for (const glyph of usedGlyphs) {
    if (glyph === '.' || glyph === '~') continue; // off-map / open sea, not a terrain def
    if (!terrainIds.has(glyph)) issues.push(`map uses glyph '${glyph}' with no matching terrain def`);
  }

  if (!def.seasons?.length) issues.push('seasons must have at least one entry');

  const buildingIds = new Set(Object.keys(def.buildings ?? {}));
  if (buildingIds.size === 0) issues.push('buildings must have at least one entry');

  const powerIds = new Set(Object.keys(def.foreignPowers ?? {}));
  if (!def.demands?.length && powerIds.size > 0) {
    issues.push('foreignPowers defined but demands is empty — no offers could ever be generated');
  }

  const endingIds = new Set(Object.keys(def.endings ?? {}));
  if (!endingIds.has('survive') && !(def.endingOrder ?? []).some((e) => def.endings?.[e])) {
    issues.push('endings should include a catch-all ending reachable when no other condition matches');
  }
  for (const e of def.endingOrder ?? []) {
    if (!endingIds.has(e)) issues.push(`endingOrder references unknown ending '${e}'`);
  }

  if (!def.newCityNames?.length) issues.push('newCityNames must have at least one entry');

  if (!def.seats?.length) issues.push('seats must have at least one entry');
  def.seats?.forEach((seat, i) => {
    for (const b of seat.city?.buildings ?? []) {
      if (!buildingIds.has(b)) issues.push(`seats[${i}] (${seat.id}) starts with unknown building '${b}'`);
    }
  });

  if (issues.length > 0) throw new ChapterValidationError(id, issues);
}
