export * from './types.js';
export * from './data.js';
export * from './hex.js';
export { random, randRange, chance } from './rng.js';
export {
  createGame,
  seasonOf,
  yearOf,
  seasonLabel,
  faction,
  humanFactions,
  aiFactions,
  cityAt,
  armyAt,
  citiesOf,
  armiesOf,
  capitalOf,
  relation,
  atWar,
  pairKey,
  visibleTo,
} from './state.js';
export type { CreateGameOptions, HumanSeatOptions } from './state.js';
export { cityYield, computeIncome, canPay, scaleCost, hasPerk, upkeepOf } from './economy.js';
export type { Income } from './economy.js';
export { reachableTiles, attackTargets, pathTo } from './movement.js';
export type { ReachTile } from './movement.js';
export { evaluateEnding, endingProgress } from './endings.js';
export type { EndingProgress } from './endings.js';
export { offeringPower, choicesFor } from './powers.js';
export { applyAction, foundBlocker, ERROR_MESSAGES } from './actions.js';
export { viewFor, describeDecision, fmtCost, seasonalCost } from './views.js';
export type { DecisionInfo, DecisionOption } from './views.js';

export const ENGINE_VERSION = '0.1.0';
