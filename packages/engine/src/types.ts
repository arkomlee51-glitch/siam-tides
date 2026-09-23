import type { LegacyCategory } from './content/legacy.js';

export type FactionId = string;
export type TerrainId = 'C' | 'K' | 'L' | 'S' | 'M';
export type SeasonId = 'rain' | 'cool' | 'hot';
export type ResourceId = 'rice' | 'man' | 'wealth' | 'faith' | 'know';
export type Resources = Record<ResourceId, number>;
export type Cost = Partial<Resources>;
export type BuildingId = 'granary' | 'market' | 'temple' | 'academy' | 'walls' | 'port';
export type PerkId = 'irrig' | 'powder' | 'print';
export type PowerId = 'lion' | 'eagle';
export type EndingId = 'ashes' | 'shadow' | 'empire' | 'river' | 'wisdom' | 'survive';
export type SeatId = 'center' | 'north' | 'east' | 'south';
export type Coord = readonly [c: number, r: number];

export interface City {
  id: string;
  name: string;
  c: number;
  r: number;
  owner: FactionId;
  capital: boolean;
  buildings: BuildingId[];
  garrison: number;
  baseGarrison: number;
}

export interface Army {
  id: string;
  owner: FactionId;
  c: number;
  r: number;
  str: number;
  morale: number;
  /** movement points left this season (human factions only) */
  mp: number;
  /** moved or fought this season — skips passive morale regen */
  moved: boolean;
}

export interface FactionStats {
  battles: number;
  wins: number;
  captures: number;
  annexed: number;
  founded: number;
  accepted: number;
  negotiated: number;
  declined: number;
}

export interface Faction {
  id: FactionId;
  name: string;
  kind: 'human' | 'ai';
  seat: SeatId;
  /** CSS token suffix used by renderers: `--own-${colorToken}` */
  colorToken: string;
  alive: boolean;
  res: Resources;
  knowTotal: number;
  faithTotal: number;
  stability: number;
  sovereignty: number;
  /** bamboo meter: -100 (lion) .. +100 (eagle) */
  meter: number;
  extremeTurns: number;
  powers: Record<PowerId, { patience: number }>;
  perks: PerkId[];
  stats: FactionStats;
  /** AI only: seasons until a new army is raised */
  recruitCd: number;
  ending: EndingId | null;
  /** Legacy carried in from this player's previous chapter (docs/adr/0007 Addendum 9) — absent = none */
  legacy?: FactionLegacy;
}

export interface FactionLegacy {
  /** merged, capped totals per category (fractions, e.g. 0.08 = +8%) — what the UI shows */
  totals: Record<LegacyCategory, number>;
  /** ongoing multiplier on this faction's city yields, applied every season by `computeIncome` */
  yieldMultiplier: Partial<Record<ResourceId, number>>;
}

export interface Relation {
  rel: number;
  war: boolean;
}

export interface PendingDecision {
  id: string;
  faction: FactionId;
  power: PowerId;
  kind: 'offer' | 'ultimatum';
  /** index into DEMANDS (offers only) */
  demand: number;
}

export type ProposalKind = 'peace';

/** A proposal one human sends another; only 'to' can answer it. Not a PendingDecision — does not block the sender's own turn. */
export interface DiplomaticProposal {
  id: string;
  kind: ProposalKind;
  from: FactionId;
  to: FactionId;
  turn: number;
}

export type EventTone = 'info' | 'good' | 'bad' | 'warn';
export type EventKind =
  'season' | 'economy' | 'battle' | 'diplomacy' | 'power' | 'perk' | 'disaster' | 'city' | 'army' | 'ending';

export interface BattleReport {
  attacker: FactionId;
  defender: FactionId;
  place: string;
  c: number;
  r: number;
  win: boolean;
  captured: boolean;
  routed: boolean;
  attackerDestroyed: boolean;
  attLoss: number;
  defLoss: number;
  atkPower: number;
  defPower: number;
  lines: string[];
}

export interface GameEvent {
  turn: number;
  /** null = everyone; otherwise only these factions see it */
  to: FactionId[] | null;
  kind: EventKind;
  tone: EventTone;
  text: string;
  battle?: BattleReport;
}

export interface ChronicleEntry {
  turn: number;
  faction: FactionId | null;
  text: string;
}

export interface GameState {
  schemaVersion: 1;
  /** which ChapterDefinition (content/chapters/*) this game's content came from */
  chapterId: string;
  seed: number;
  /** mulberry32 state — all randomness goes through this so the server can replay */
  rng: number;
  turn: number;
  maxTurn: number;
  cities: City[];
  armies: Army[];
  factions: Record<FactionId, Faction>;
  /** stable iteration order */
  order: FactionId[];
  relations: Record<string, Relation>;
  pending: PendingDecision[];
  /** proposals awaiting the other human's answer (e.g. peace) */
  proposals: DiplomaticProposal[];
  /** human factions that ended the current season */
  ready: FactionId[];
  log: GameEvent[];
  chronicle: ChronicleEntry[];
  nextId: number;
  cityNameIdx: number;
  ended: boolean;
}

export type DecisionChoice = 'accept' | 'negotiate' | 'decline' | 'pay' | 'yield';

export type Action =
  | { type: 'move'; armyId: string; c: number; r: number }
  | { type: 'attack'; armyId: string; c: number; r: number }
  | { type: 'camp'; armyId: string }
  | { type: 'found'; armyId: string }
  | { type: 'build'; cityId: string; building: BuildingId }
  | { type: 'recruit'; cityId: string }
  | { type: 'tribute'; target: FactionId }
  | { type: 'festival'; target: FactionId }
  | { type: 'annex'; target: FactionId }
  | { type: 'declareWar'; target: FactionId }
  | { type: 'offerPeace'; target: FactionId }
  | { type: 'proposePeace'; target: FactionId }
  | { type: 'answerProposal'; proposalId: string; accept: boolean }
  | { type: 'envoy'; power: PowerId }
  | { type: 'answerDecision'; decisionId: string; choice: DecisionChoice }
  | { type: 'endTurn' };

export type ActionType = Action['type'];

export type ActionError =
  | 'GAME_OVER'
  | 'NOT_YOUR_FACTION'
  | 'FACTION_ELIMINATED'
  | 'ALREADY_READY'
  | 'PENDING_DECISION'
  | 'NOT_FOUND'
  | 'NOT_OWNER'
  | 'INSUFFICIENT_RESOURCES'
  | 'NO_MOVES_LEFT'
  | 'UNREACHABLE'
  | 'NOT_ADJACENT'
  | 'NOT_AT_WAR'
  | 'AT_WAR'
  | 'INVALID_LOCATION'
  | 'ALREADY_BUILT'
  | 'NOT_COASTAL'
  | 'ARMY_FULL'
  | 'RELATION_TOO_LOW'
  | 'INVALID_TARGET'
  | 'INVALID_CHOICE'
  | 'UNKNOWN_ACTION';

export type ActionResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: ActionError; message: string };
