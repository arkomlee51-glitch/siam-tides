import { RESOURCES, scaleCost, seasonOf } from '@siam/engine';
import type { Cost, GameState, ResourceId } from '@siam/engine';

export const RES_ORDER: ResourceId[] = ['rice', 'man', 'wealth', 'faith', 'know'];

export const costText = (cost: Cost): string =>
  RES_ORDER.filter((k) => cost[k] !== undefined)
    .map((k) => `${RESOURCES[k].icon}${cost[k]}`)
    .join(' ');

export const seasonalCostOf = (state: GameState, base: Cost, kind: 'build' | 'diplo' | 'recruit'): Cost =>
  scaleCost(base, seasonOf(state.turn)[kind]);

export const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));
