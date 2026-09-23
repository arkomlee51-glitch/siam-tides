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
import {
  ApiError,
  createGame as createServerGame,
  createLobby as createServerLobby,
  fetchGame,
  fetchLobby,
  joinLobby as joinServerLobby,
  leaveLobby as leaveServerLobby,
  sendAction,
  startLobby as startServerLobby,
} from './api/client';
import type { Lobby } from './api/client';
import { clearSession, loadSession, saveSession } from './api/session';
import type { OnlineSession } from './api/session';
import { connectGameSocket } from './api/socket';
import type { Connection, GameSocket } from './api/socket';
import { ensureSession } from './api/supabase';

export type Tab = 'info' | 'diplo' | 'bamboo' | 'goals' | 'log';

/** local = engine ในเครื่องตัดสิน, server = server ตัดสินและ client ทำ optimistic update */
export type Mode = 'local' | 'server';

export type Modal =
  | { kind: 'intro' }
  | { kind: 'season'; events: GameEvent[]; turn: number }
  | { kind: 'battle'; report: BattleReport }
  | { kind: 'ending' }
  | { kind: 'account' }
  | { kind: 'lobby' }
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; danger?: boolean; action: Action };

export const ME: FactionId = 'p1';
const MY_NAME = 'อาณาจักรนที';

/** คำสั่งที่ผลลัพธ์ขึ้นกับการสุ่ม — client ทายเองไม่ได้ จึงรอคำตอบจาก server */
const RNG_ACTIONS: ReadonlySet<Action['type']> = new Set(['attack', 'offerPeace', 'endTurn']);

const mineOnly = (events: GameEvent[]) => events.filter((e) => e.to === null || e.to.includes(ME));

function modalsFrom(events: GameEvent[], state: GameState): Modal[] {
  const modals: Modal[] = [];
  const myBattle = events.find((e) => e.kind === 'battle' && e.battle?.attacker === ME);
  if (myBattle?.battle) modals.push({ kind: 'battle', report: myBattle.battle });
  if (events.some((e) => e.kind === 'season')) {
    modals.push({ kind: 'season', events: events.filter((e) => e.kind !== 'season'), turn: state.turn });
  }
  if (state.ended) modals.push({ kind: 'ending' });
  return modals;
}

const newIdempotencyKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export interface Store {
  state: GameState;
  sel: { c: number; r: number } | null;
  tab: Tab;
  modals: Modal[];
  toast: string | null;
  loaded: boolean;

  mode: Mode;
  session: OnlineSession | null;
  /** version ของ state ตามที่ server บอก (โหมด local ไม่ใช้) */
  version: number;
  connection: Connection;
  /** จำนวนคำสั่งที่ยังรอคำตอบจาก server */
  inFlight: number;
  socket: GameSocket | null;
  /** เฟส 5: ห้องรอที่กำลังอยู่ (ก่อนเกมเริ่ม) — null ถ้าไม่ได้อยู่ในห้องรอ */
  lobby: Lobby | null;
  lobbyBusy: boolean;

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

  goOnline: (seed?: number) => Promise<void>;
  resumeOnline: (gameId: string) => Promise<void>;
  goOffline: () => void;
  refresh: () => Promise<void>;
  applyServer: (version: number, view: GameState, events: GameEvent[]) => void;
  openSocket: () => void;

  /** เฟส 5: ห้องรอ/รหัสเชิญ */
  createLobby: (seasonTimerSeconds?: number) => Promise<void>;
  joinLobby: (code: string) => Promise<void>;
  refreshLobby: () => Promise<void>;
  leaveLobby: () => Promise<void>;
  startLobby: () => Promise<void>;
}

const fresh = (seed?: number) => createGame({ seed, humans: [{ id: ME, name: MY_NAME }] });

export const useStore = create<Store>((set, get) => ({
  state: fresh(),
  sel: null,
  tab: 'info',
  modals: [{ kind: 'intro' }],
  toast: null,
  loaded: false,

  mode: 'local',
  session: null,
  version: 0,
  connection: 'offline',
  inFlight: 0,
  socket: null,
  lobby: null,
  lobbyBusy: false,

  dispatch(action) {
    return get().mode === 'server' ? dispatchOnline(set, get, action) : dispatchLocal(set, get, action);
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
    if (get().mode === 'server') {
      void get().goOnline(seed);
      return;
    }
    void clearSave();
    const state = fresh(seed);
    set({ state, sel: null, tab: 'info', modals: [{ kind: 'intro' }], toast: null });
    void saveGame(state);
  },

  async hydrate() {
    // มี Supabase session ไว้ก่อนเสมอ (anonymous ถ้ายังไม่เคยผูกบัญชี) เพื่อให้ยังเล่น local ต่อได้ถ้าออนไลน์ไม่สำเร็จ
    await ensureSession().catch(() => undefined);

    const session = loadSession();
    if (session) {
      try {
        const snapshot = await fetchGame(session.gameId);
        set({
          mode: 'server',
          session,
          state: snapshot.view,
          version: snapshot.version,
          sel: null,
          modals: [],
          loaded: true,
        });
        get().openSocket();
        return;
      } catch {
        clearSession();
      }
    }
    const saved = await loadSave();
    if (saved) set({ state: saved, modals: [], loaded: true });
    else set({ loaded: true });
  },

  async goOnline(seed) {
    get().socket?.close();
    set({ connection: 'connecting', socket: null });
    try {
      await ensureSession();
      const created = await createServerGame({ seed, name: MY_NAME });
      enterServer(
        set,
        get,
        { gameId: created.gameId, factionId: created.factionId },
        created.view,
        created.version,
        [{ kind: 'intro' }],
      );
    } catch (err) {
      set({ connection: 'offline' });
      get().showToast(
        err instanceof ApiError ? err.message : 'เชื่อมต่อ server ไม่ได้ เล่นในเครื่องต่อได้เลย',
      );
    }
  },

  async resumeOnline(gameId) {
    get().socket?.close();
    set({ connection: 'connecting', socket: null });
    try {
      await ensureSession();
      const snapshot = await fetchGame(gameId);
      enterServer(set, get, { gameId, factionId: snapshot.factionId }, snapshot.view, snapshot.version, []);
    } catch (err) {
      set({ connection: 'offline' });
      get().showToast(err instanceof ApiError ? err.message : 'เข้าเกมนี้ไม่สำเร็จ');
    }
  },

  async createLobby(seasonTimerSeconds) {
    if (get().lobbyBusy) return;
    set({ lobbyBusy: true });
    try {
      await ensureSession();
      const lobby = await createServerLobby({ name: MY_NAME, seasonTimerSeconds });
      set({ lobby });
      startLobbyPolling(get);
    } catch (err) {
      get().showToast(err instanceof ApiError ? err.message : 'สร้างห้องรอไม่สำเร็จ');
    } finally {
      set({ lobbyBusy: false });
    }
  },

  async joinLobby(code) {
    if (get().lobbyBusy) return;
    set({ lobbyBusy: true });
    try {
      await ensureSession();
      const lobby = await joinServerLobby(code.trim().toUpperCase(), MY_NAME);
      set({ lobby });
      startLobbyPolling(get);
    } catch (err) {
      get().showToast(err instanceof ApiError ? err.message : 'เข้าร่วมห้องไม่สำเร็จ ตรวจรหัสอีกครั้ง');
    } finally {
      set({ lobbyBusy: false });
    }
  },

  async refreshLobby() {
    const code = get().lobby?.code;
    if (!code) return;
    try {
      const lobby = await fetchLobby(code);
      if (lobby.startedGameId) {
        // host เริ่มเกมแล้วจากอีกที่นั่งหนึ่ง — ดึงเกมจริงมาแทนที่ห้องรอ
        stopLobbyPolling();
        const gameId = lobby.startedGameId;
        set({ lobby: null });
        await get().resumeOnline(gameId);
        return;
      }
      set({ lobby });
    } catch {
      // ห้องหายไปแล้ว (เช่น host ออก หรือ TTL หมด) — เลิก poll เงียบ ๆ ให้ UI แสดงว่าห้องถูกยกเลิก
      stopLobbyPolling();
      set({ lobby: null });
    }
  },

  async leaveLobby() {
    const code = get().lobby?.code;
    stopLobbyPolling();
    set({ lobby: null });
    if (code) await leaveServerLobby(code).catch(() => undefined);
  },

  async startLobby() {
    const code = get().lobby?.code;
    if (!code || get().lobbyBusy) return;
    set({ lobbyBusy: true });
    try {
      const created = await startServerLobby(code);
      stopLobbyPolling();
      set({ lobby: null });
      enterServer(
        set,
        get,
        { gameId: created.gameId, factionId: created.factionId },
        created.view,
        created.version,
        [{ kind: 'intro' }],
      );
    } catch (err) {
      get().showToast(err instanceof ApiError ? err.message : 'เริ่มเกมไม่สำเร็จ');
    } finally {
      set({ lobbyBusy: false });
    }
  },

  goOffline() {
    stopLobbyPolling();
    set({ lobby: null });
    get().socket?.close();
    clearSession();
    set({ mode: 'local', session: null, socket: null, connection: 'offline', inFlight: 0, version: 0 });
    void (async () => {
      const saved = await loadSave();
      const state = saved ?? fresh();
      set({ state, sel: null, tab: 'info', modals: saved ? [] : [{ kind: 'intro' }] });
      if (!saved) void saveGame(state);
    })();
  },

  async refresh() {
    const { session } = get();
    if (!session) return;
    const snapshot = await fetchGame(session.gameId);
    set({ state: snapshot.view, version: snapshot.version });
  },

  applyServer(version, view, events) {
    if (version <= get().version) return;
    set({ state: view, version, modals: [...get().modals, ...modalsFrom(events, view)] });
  },

  openSocket() {
    const { session } = get();
    get().socket?.close();
    if (!session) {
      set({ socket: null, connection: 'offline' });
      return;
    }
    const socket = connectGameSocket(session.gameId, {
      onStatus: (connection) => set({ connection }),
      onFrame: (frame) => {
        if (frame.type === 'sync') {
          if (frame.version >= get().version) set({ state: frame.view, version: frame.version });
        } else if (frame.type === 'update') {
          get().applyServer(frame.version, frame.view, frame.events);
        } else if (frame.type === 'error') {
          get().showToast(frame.message);
        }
      },
    });
    set({ socket });
  },
}));

type Set = (partial: Partial<Store>) => void;
type Get = () => Store;

/** ใช้ร่วมกันโดย goOnline/resumeOnline/startLobby — ต่างกันแค่ session/state/version/modals ตอนเข้าโหมด server */
function enterServer(
  set: Set,
  get: Get,
  session: OnlineSession,
  view: GameState,
  version: number,
  modals: Modal[],
): void {
  saveSession(session);
  void clearSave();
  set({
    mode: 'server',
    session,
    state: view,
    version,
    sel: null,
    tab: 'info',
    modals,
    toast: null,
    loaded: true,
    inFlight: 0,
  });
  get().openSocket();
}

/** timer ของการ poll ห้องรอ — เก็บนอก store เพราะไม่ใช่ state ที่ต้อง re-render ตาม */
let lobbyPollTimer: ReturnType<typeof setInterval> | null = null;

function startLobbyPolling(get: Get): void {
  stopLobbyPolling();
  lobbyPollTimer = setInterval(() => void get().refreshLobby(), 2000);
}

function stopLobbyPolling(): void {
  if (lobbyPollTimer) clearInterval(lobbyPollTimer);
  lobbyPollTimer = null;
}

/** โหมดในเครื่อง: engine ตัดสินทันที (พฤติกรรมเดียวกับเฟส 2) */
function dispatchLocal(set: Set, get: Get, action: Action): boolean {
  const { state } = get();
  const res = applyAction(state, ME, action);
  if (!res.ok) {
    get().showToast(res.message || ERROR_MESSAGES[res.error]);
    return false;
  }
  const mine = mineOnly(res.events);
  set({
    state: res.state,
    modals: [...get().modals, ...modalsFrom(mine, res.state)],
    sel: action.type === 'move' ? { c: action.c, r: action.r } : get().sel,
  });
  void saveGame(res.state);
  return true;
}

/**
 * โหมด server: ตรวจคำสั่งด้วย engine ในเครื่องก่อนเพื่อได้ feedback ทันที
 * คำสั่งที่ไม่มีการสุ่มจะอัปเดตหน้าจอทันที (optimistic) แล้วค่อย reconcile ตาม version ที่ server ตอบ
 */
function dispatchOnline(set: Set, get: Get, action: Action): boolean {
  const { state, session, version } = get();
  if (!session) {
    get().showToast('ยังไม่ได้เชื่อมต่อ server');
    return false;
  }
  const local = applyAction(state, ME, action);
  if (!local.ok) {
    get().showToast(local.message || ERROR_MESSAGES[local.error]);
    return false;
  }

  const optimistic = !RNG_ACTIONS.has(action.type);
  const previous = state;
  if (optimistic) {
    set({
      state: local.state,
      sel: action.type === 'move' ? { c: action.c, r: action.r } : get().sel,
    });
  }
  set({ inFlight: get().inFlight + 1 });

  void (async () => {
    try {
      const outcome = await sendAction({
        gameId: session.gameId,
        action,
        expectedVersion: version,
        idempotencyKey: newIdempotencyKey(),
      });
      get().applyServer(outcome.version, outcome.view, outcome.events);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const details = err.details as { version?: number; view?: GameState } | undefined;
        if (typeof details?.version === 'number' && details.view) {
          set({ state: details.view, version: details.version });
        } else {
          await get()
            .refresh()
            .catch(() => undefined);
        }
        get().showToast('สถานะเกมเปลี่ยนไปแล้ว ดึงสถานะล่าสุดมาให้แล้ว ลองสั่งอีกครั้ง');
      } else {
        if (optimistic) set({ state: previous });
        get().showToast(err instanceof ApiError ? err.message : 'ส่งคำสั่งไป server ไม่สำเร็จ');
      }
    } finally {
      set({ inFlight: Math.max(0, get().inFlight - 1) });
    }
  })();

  return true;
}

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
