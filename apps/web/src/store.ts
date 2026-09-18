import { create } from 'zustand';
import {
  ERROR_MESSAGES,
  applyAction,
  armyAt,
  atWar,
  attackTargets,
  createGame,
  faction,
  reachableTiles,
} from '@siam/engine';
import type { Action, Army, BattleReport, FactionId, GameEvent, GameState, ReachTile } from '@siam/engine';
import { loadSave, saveGame, clearSave } from './persist';

export type Tab = 'info' | 'diplo' | 'bamboo' | 'goals' | 'log';

export type Modal =
  | { kind: 'intro' }
  | { kind: 'season'; events: GameEvent[]; turn: number }
  | { kind: 'battle'; report: BattleReport }
  | { kind: 'ending' }
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; danger?: boolean; action: Action };

export const ME: FactionId = 'p1';

export interface Store {
  state: GameState;
  sel: { c: number; r: number } | null;
  tab: Tab;
  modals: Modal[];
  toast: string | null;
  loaded: boolean;

  dispatch: (action: Action) => boolean;
  clickTile: (c: number, r: number) => void;
  select: (c: number, r: number) => void;
  setTab: (tab: Tab) => void;
  pushModal: (modal: Modal) => void;
  closeModal: () => void;
  confirmModal: () => void;
  showToast: (text: string) => void;
  newGame: (seed?: number) => void;
  hydrate: () => Promise<void>;
}

const fresh = (seed?: number) => createGame({ seed, humans: [{ id: ME, name: 'อาณาจักรนที' }] });

export const useStore = create<Store>((set, get) => ({
  state: fresh(),
  sel: null,
  tab: 'info',
  modals: [{ kind: 'intro' }],
  toast: null,
  loaded: false,

  dispatch(action) {
    const { state } = get();
    const res = applyAction(state, ME, action);
    if (!res.ok) {
      get().showToast(res.message || ERROR_MESSAGES[res.error]);
      return false;
    }
    const mine = res.events.filter((e) => e.to === null || e.to.includes(ME));
    const modals: Modal[] = [];
    const myBattle = mine.find((e) => e.kind === 'battle' && e.battle?.attacker === ME);
    if (myBattle?.battle) modals.push({ kind: 'battle', report: myBattle.battle });
    if (mine.some((e) => e.kind === 'season')) {
      modals.push({ kind: 'season', events: mine.filter((e) => e.kind !== 'season'), turn: res.state.turn });
    }
    if (res.state.ended) modals.push({ kind: 'ending' });
    set({
      state: res.state,
      modals: [...get().modals, ...modals],
      sel: action.type === 'move' ? { c: action.c, r: action.r } : get().sel,
    });
    void saveGame(res.state);
    return true;
  },

  clickTile(c, r) {
    const { state, dispatch, select } = get();
    if (state.ended || state.pending.length) return select(c, r);
    const army = selectedOwnArmy(get());
    if (army) {
      if (reachableTiles(state, army).has(`${c},${r}`)) {
        dispatch({ type: 'move', armyId: army.id, c, r });
        return;
      }
      if (attackTargets(state, army).has(`${c},${r}`)) {
        dispatch({ type: 'attack', armyId: army.id, c, r });
        return;
      }
      const enemy = armyAt(state, c, r);
      if (enemy && enemy.owner !== ME && !atWar(state, ME, enemy.owner)) {
        get().showToast(`ยังไม่ได้ทำสงครามกับ${faction(state, enemy.owner).name} ประกาศได้ที่แท็บการทูต`);
      }
    }
    select(c, r);
  },

  select(c, r) {
    set({ sel: { c, r }, tab: 'info' });
  },
  setTab(tab) {
    set({ tab });
  },
  pushModal(modal) {
    set({ modals: [...get().modals, modal] });
  },
  closeModal() {
    set({ modals: get().modals.slice(1) });
  },
  confirmModal() {
    const modal = get().modals[0];
    set({ modals: get().modals.slice(1) });
    if (modal?.kind === 'confirm') get().dispatch(modal.action);
  },
  showToast(text) {
    set({ toast: text });
    setTimeout(() => {
      if (get().toast === text) set({ toast: null });
    }, 2800);
  },
  newGame(seed) {
    void clearSave();
    const state = fresh(seed);
    set({ state, sel: null, tab: 'info', modals: [{ kind: 'intro' }], toast: null });
    void saveGame(state);
  },
  async hydrate() {
    const saved = await loadSave();
    if (saved) set({ state: saved, modals: [], loaded: true });
    else set({ loaded: true });
  },
}));

export function selectedOwnArmy(store: Pick<Store, 'state' | 'sel'>): Army | null {
  if (!store.sel) return null;
  const army = armyAt(store.state, store.sel.c, store.sel.r);
  return army && army.owner === ME ? army : null;
}

export function selectionOverlay(store: Pick<Store, 'state' | 'sel'>): {
  sel: { c: number; r: number } | null;
  reach: ReachTile[];
  attack: { c: number; r: number }[];
} {
  const army = selectedOwnArmy(store);
  if (!army || store.state.ended) return { sel: store.sel, reach: [], attack: [] };
  const attack = [...attackTargets(store.state, army)].map((k) => {
    const [c, r] = k.split(',').map(Number);
    return { c: c!, r: r! };
  });
  return { sel: store.sel, reach: [...reachableTiles(store.state, army).values()], attack };
}
