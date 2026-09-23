import { SEASONS } from './data.js';
import type { SeasonDef } from './data.js';
import { earlyRattanakosinChapter } from './content/chapters/early-rattanakosin.js';
import { LEGACY_CATEGORIES, applyLegacyBonuses, clampLegacyTotals } from './content/legacy.js';
import type { LegacyCategory } from './content/legacy.js';
import { CORE_RESOURCE_IDS } from './content/schema.js';
import type { ChapterDefinition } from './content/schema.js';
import type {
  Army,
  ChronicleEntry,
  City,
  EventKind,
  EventTone,
  Faction,
  FactionId,
  FactionStats,
  GameEvent,
  GameState,
  PowerId,
  Relation,
} from './types.js';

export interface Ctx {
  s: GameState;
  ev: GameEvent[];
}

export interface HumanSeatOptions {
  id: FactionId;
  name?: string;
  /**
   * Merged Legacy totals this player carries in from their previous chapter
   * (`mergeLegacyBonuses` output). Clamped to `LEGACY_CAPS` here regardless of what the
   * caller passes. Omit for no Legacy. See docs/adr/0007 Addendum 9.
   */
  legacy?: Partial<Record<LegacyCategory, number>>;
}
export interface CreateGameOptions {
  seed?: number;
  /** 1–4 human players; they take seats in order center, north, east, south */
  humans?: HumanSeatOptions[];
  maxTurn?: number;
  /**
   * Which chapter's seats/starting rules to build the game from. Defaults to the one
   * chapter that ships today (`content/chapters/early-rattanakosin.ts`, itself derived
   * from `data.ts`).
   *
   * NOTE (เฟส 6, ดู ADR-0007 ข้อ 7 + Addendum 4-7): state *setup* (seats, starting
   * resources/stability/garrison, maxTurn, foreign-power roster) is chapter-driven, and so
   * is all gameplay logic that reads content — `economy.ts` (city yields, upkeep, perks),
   * `combat.ts` (terrain/city/building defense, captured garrisons, perks), `movement.ts`
   * and `ai.ts` (terrain move cost, AI balance rules), `turn.ts`, `powers.ts`,
   * `endings.ts`, `actions.ts`, `views.ts` — plus the web UI (`apps/web/src/ui/format.ts#
   * chapterOf`). They all resolve chapter data by `GameState.chapterId` via
   * `content/chapters/index.ts#getChapterById`. Exceptions, on purpose:
   * (1) Every function above resolves chapter content from the **registry**, keyed by
   *     `chapter.manifest.id` — NOT from the specific `ChapterDefinition` object passed
   *     here. Pass a `chapter` object whose id is registered with different data and you
   *     get setup from the object but gameplay from the registered chapter. Only matters
   *     once a second chapter is registered.
   * (2) `hex.ts` (and the web map renderer) still read `MAP`/`RIVER`/terrain glyphs from
   *     `data.ts` as module-level singletons — ADR-0007 Addendum 6.
   * (3) `seasonOf` below still reads `SEASONS` from `data.ts`: the season list is coupled
   *     to `turn.ts`'s bespoke seasonal-event code (and `ai.ts`'s `'rain'` check), which
   *     waits for a `SeasonalEventDef` schema — ADR-0007 Addendum 5/7.
   */
  chapter?: ChapterDefinition;
}

const emptyStats = (): FactionStats => ({
  battles: 0,
  wins: 0,
  captures: 0,
  annexed: 0,
  founded: 0,
  accepted: 0,
  negotiated: 0,
  declined: 0,
});

export function createGame(opts: CreateGameOptions = {}): GameState {
  const chapter = opts.chapter ?? earlyRattanakosinChapter;
  const seats = chapter.seats;
  const rules = chapter.rules;
  const powerIds = Object.keys(chapter.foreignPowers) as PowerId[];
  const humans = opts.humans?.length ? opts.humans : [{ id: 'p1' }];
  if (humans.length > seats.length) throw new Error(`at most ${seats.length} human players`);
  const ids = new Set<string>();
  /** human faction id → additive starting relation toward every AI faction, from Legacy */
  const legacyRelation = new Map<FactionId, number>();
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
  const s: GameState = {
    schemaVersion: 1,
    chapterId: chapter.manifest.id,
    seed,
    rng: seed,
    turn: 1,
    maxTurn: opts.maxTurn ?? rules.maxTurn,
    cities: [],
    armies: [],
    factions: {},
    order: [],
    relations: {},
    pending: [],
    proposals: [],
    ready: [],
    log: [],
    chronicle: [],
    nextId: 1,
    cityNameIdx: 0,
    ended: false,
  };
  seats.forEach((seat, i) => {
    const human = humans[i];
    const id = human ? human.id : seat.id;
    if (ids.has(id) || id.includes('|')) throw new Error(`invalid or duplicate faction id: ${id}`);
    ids.add(id);
    const f: Faction = {
      id,
      name: human?.name ?? seat.factionName,
      kind: human ? 'human' : 'ai',
      // seat.id is a plain string in ChapterDefinition (data-driven); GameState's Faction.seat
      // still uses the literal SeatId union — see the "NOTE (เฟส 6)" doc comment above.
      seat: seat.id as Faction['seat'],
      colorToken: seat.colorToken,
      alive: true,
      res: { ...rules.startResources },
      knowTotal: 0,
      faithTotal: 0,
      stability: rules.startStability,
      sovereignty: 100,
      meter: 0,
      extremeTurns: 0,
      powers: Object.fromEntries(powerIds.map((p) => [p, { patience: 3 }])) as Faction['powers'],
      perks: [],
      stats: emptyStats(),
      recruitCd: 0,
      ending: null,
    };
    let legacyArmyMultiplier = 1;
    if (human?.legacy) {
      const totals = clampLegacyTotals(human.legacy);
      if (LEGACY_CATEGORIES.some((c) => totals[c] > 0)) {
        const adj = applyLegacyBonuses(totals);
        f.stability = clamp(f.stability + adj.stabilityBonus, 0, 100);
        for (const k of CORE_RESOURCE_IDS) f.res[k] += adj.startResourceBonus[k] ?? 0;
        f.legacy = { totals, yieldMultiplier: adj.cityYieldMultiplier };
        legacyArmyMultiplier = adj.armyStrMultiplier;
        legacyRelation.set(id, adj.relationBonus);
      }
    }
    s.factions[id] = f;
    s.order.push(id);
    const g = human ? rules.humanCapitalGarrison : seat.city.aiGarrison;
    s.cities.push({
      id: newId(s, 'c'),
      name: seat.city.name,
      c: seat.city.c,
      r: seat.city.r,
      owner: id,
      capital: true,
      // same data-driven-string-to-literal-union note as `seat` above
      buildings: [...seat.city.buildings] as City['buildings'],
      garrison: g,
      baseGarrison: g,
    });
    s.armies.push({
      id: newId(s, 'a'),
      owner: id,
      c: seat.army.c,
      r: seat.army.r,
      str: human ? Math.round(seat.army.humanStr * legacyArmyMultiplier) : seat.army.aiStr,
      morale: human ? 90 : 85,
      mp: human ? seasonOf(1).move : 0,
      moved: false,
    });
  });
  // relations: AI attitude toward humans comes from the AI seat
  for (let i = 0; i < s.order.length; i++)
    for (let j = i + 1; j < s.order.length; j++) {
      const a = faction(s, s.order[i]!);
      const b = faction(s, s.order[j]!);
      let rel = 0;
      if (a.kind !== b.kind) {
        const ai = a.kind === 'ai' ? a : b;
        rel = seats.find((x) => x.id === ai.seat)?.aiRelation ?? 0;
      }
      s.relations[pairKey(a.id, b.id)] = { rel, war: false };
    }
  for (const [humanId, bonus] of legacyRelation) {
    if (bonus <= 0) continue;
    for (const other of Object.values(s.factions)) {
      if (other.kind !== 'ai') continue;
      const r = s.relations[pairKey(humanId, other.id)];
      if (r) r.rel = clamp(r.rel + bonus, -100, 100);
    }
  }
  for (const f of humanFactions(s)) {
    const cap = capitalOf(s, f.id);
    chronicle(s, f.id, `ก่อตั้ง${cap?.name ?? 'เมืองหลวง'}`);
  }
  return s;
}

/* ---------- ids / lookups ---------- */
export function newId(s: GameState, prefix: string): string {
  return `${prefix}${s.nextId++}`;
}
export const seasonOf = (turn: number): SeasonDef => SEASONS[(turn - 1) % 3]!;
export const yearOf = (turn: number): number => Math.floor((turn - 1) / 3) + 1;
export const seasonLabel = (turn: number): string => `ปีที่ ${yearOf(turn)} ${seasonOf(turn).name}`;

export function faction(s: GameState, id: FactionId): Faction {
  const f = s.factions[id];
  if (!f) throw new Error(`unknown faction ${id}`);
  return f;
}
export const humanFactions = (s: GameState): Faction[] =>
  s.order.map((id) => faction(s, id)).filter((f) => f.kind === 'human' && f.alive);
export const aiFactions = (s: GameState): Faction[] =>
  s.order.map((id) => faction(s, id)).filter((f) => f.kind === 'ai' && f.alive);

export const cityAt = (s: GameState, c: number, r: number): City | undefined =>
  s.cities.find((x) => x.c === c && x.r === r);
export const armyAt = (s: GameState, c: number, r: number): Army | undefined =>
  s.armies.find((x) => x.c === c && x.r === r);
export const citiesOf = (s: GameState, id: FactionId): City[] => s.cities.filter((x) => x.owner === id);
export const armiesOf = (s: GameState, id: FactionId): Army[] => s.armies.filter((x) => x.owner === id);
export const capitalOf = (s: GameState, id: FactionId): City | undefined =>
  s.cities.find((c) => c.owner === id && c.capital) ?? s.cities.find((c) => c.owner === id);

export const pairKey = (a: FactionId, b: FactionId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
export function relation(s: GameState, a: FactionId, b: FactionId): Relation {
  const r = s.relations[pairKey(a, b)];
  if (!r) throw new Error(`no relation ${a}/${b}`);
  return r;
}
export const atWar = (s: GameState, a: FactionId, b: FactionId): boolean => a !== b && relation(s, a, b).war;

export function removeArmy(s: GameState, army: Army): void {
  s.armies = s.armies.filter((x) => x !== army);
}

/* ---------- events ---------- */
export function emit(
  ctx: Ctx,
  to: FactionId[] | null,
  kind: EventKind,
  tone: EventTone,
  text: string,
  extra: Partial<GameEvent> = {},
): GameEvent {
  const e: GameEvent = { turn: ctx.s.turn, to, kind, tone, text, ...extra };
  ctx.ev.push(e);
  return e;
}
export function chronicle(s: GameState, fid: FactionId | null, text: string): void {
  const entry: ChronicleEntry = { turn: s.turn, faction: fid, text };
  s.chronicle.push(entry);
}
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Events a given faction is allowed to see (use this before sending state to a client). */
export const visibleTo = (e: GameEvent, fid: FactionId): boolean => e.to === null || e.to.includes(fid);
