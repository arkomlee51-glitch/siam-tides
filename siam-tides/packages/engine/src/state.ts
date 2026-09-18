import { POWER_IDS, RULES, SEASONS, SEATS } from './data.js';
import type { SeasonDef } from './data.js';
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
  Relation,
} from './types.js';

export interface Ctx {
  s: GameState;
  ev: GameEvent[];
}

export interface HumanSeatOptions {
  id: FactionId;
  name?: string;
}
export interface CreateGameOptions {
  seed?: number;
  /** 1–4 human players; they take seats in order center, north, east, south */
  humans?: HumanSeatOptions[];
  maxTurn?: number;
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
  const humans = opts.humans?.length ? opts.humans : [{ id: 'p1' }];
  if (humans.length > SEATS.length) throw new Error(`at most ${SEATS.length} human players`);
  const ids = new Set<string>();
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
  const s: GameState = {
    schemaVersion: 1,
    seed,
    rng: seed,
    turn: 1,
    maxTurn: opts.maxTurn ?? RULES.maxTurn,
    cities: [],
    armies: [],
    factions: {},
    order: [],
    relations: {},
    pending: [],
    ready: [],
    log: [],
    chronicle: [],
    nextId: 1,
    cityNameIdx: 0,
    ended: false,
  };
  SEATS.forEach((seat, i) => {
    const human = humans[i];
    const id = human ? human.id : seat.id;
    if (ids.has(id) || id.includes('|')) throw new Error(`invalid or duplicate faction id: ${id}`);
    ids.add(id);
    const f: Faction = {
      id,
      name: human?.name ?? seat.factionName,
      kind: human ? 'human' : 'ai',
      seat: seat.id,
      colorToken: seat.colorToken,
      alive: true,
      res: { ...RULES.startResources },
      knowTotal: 0,
      faithTotal: 0,
      stability: RULES.startStability,
      sovereignty: 100,
      meter: 0,
      extremeTurns: 0,
      powers: Object.fromEntries(POWER_IDS.map((p) => [p, { patience: 3 }])) as Faction['powers'],
      perks: [],
      stats: emptyStats(),
      recruitCd: 0,
      ending: null,
    };
    s.factions[id] = f;
    s.order.push(id);
    const g = human ? RULES.humanCapitalGarrison : seat.city.aiGarrison;
    s.cities.push({
      id: newId(s, 'c'),
      name: seat.city.name,
      c: seat.city.c,
      r: seat.city.r,
      owner: id,
      capital: true,
      buildings: [...seat.city.buildings],
      garrison: g,
      baseGarrison: g,
    });
    s.armies.push({
      id: newId(s, 'a'),
      owner: id,
      c: seat.army.c,
      r: seat.army.r,
      str: human ? seat.army.humanStr : seat.army.aiStr,
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
        rel = SEATS.find((x) => x.id === ai.seat)?.aiRelation ?? 0;
      }
      s.relations[pairKey(a.id, b.id)] = { rel, war: false };
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
