import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, armiesOf, createGame, viewFor } from '@siam/engine';
import type { Action, GameState } from '@siam/engine';

/**
 * เฟส 4: token ต่อที่นั่งแบบเฟส 3 หายไปแล้ว — client คุยกับ server ด้วย Supabase access token
 * (ดึงผ่าน ensureSession/getAccessToken ใน src/api/supabase.ts) เทสต์นี้จึง mock โมดูลนั้นทั้งก้อน
 * เพื่อไม่ให้ store/client ไปยิง network จริงตอนเรียก ensureSession()/getAccessToken()
 */
vi.mock('../src/api/supabase', () => ({
  ensureSession: vi.fn().mockResolvedValue({ access_token: 'test-access-token' }),
  getAccessToken: vi.fn().mockResolvedValue('test-access-token'),
  currentUser: vi.fn().mockResolvedValue(null),
  linkEmail: vi.fn(),
  signOut: vi.fn(),
  supabase: {},
}));

const { ME, useStore } = await import('../src/store');

const GAME_ID = '11111111-1111-4111-8111-111111111111';

interface FakeServer {
  state: GameState;
  version: number;
  calls: { url: string; body?: unknown }[];
  conflict: boolean;
}

let server: FakeServer;

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function install(): void {
  vi.stubGlobal('WebSocket', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      server.calls.push({ url, body });

      if (url.endsWith('/games') && init?.method === 'POST') {
        // เฟส 4: POST /games คืน Snapshot ตรง ๆ — ไม่มี players/token ต่อที่นั่งแบบเฟส 3 อีกแล้ว
        return respond(201, {
          gameId: GAME_ID,
          version: 0,
          seq: 0,
          factionId: ME,
          view: viewFor(server.state, ME),
        });
      }
      if (url.endsWith(`/games/${GAME_ID}`)) {
        return respond(200, {
          gameId: GAME_ID,
          version: server.version,
          seq: server.version,
          factionId: ME,
          view: viewFor(server.state, ME),
        });
      }
      if (url.endsWith(`/games/${GAME_ID}/actions`)) {
        if (server.conflict) {
          return respond(409, {
            error: 'VERSION_CONFLICT',
            message: 'สถานะเกมเปลี่ยนไปแล้ว',
            details: { version: server.version, seq: server.version, view: viewFor(server.state, ME) },
          });
        }
        const result = applyAction(server.state, ME, body?.action as Action);
        if (!result.ok) return respond(422, { error: result.error, message: result.message });
        server.state = result.state;
        server.version += 1;
        return respond(200, {
          gameId: GAME_ID,
          version: server.version,
          seq: server.version,
          factionId: ME,
          view: viewFor(server.state, ME),
          events: result.events.filter((e) => e.to === null || e.to.includes(ME)),
          replayed: false,
        });
      }
      return respond(404, { error: 'NOT_FOUND', message: 'ไม่พบเส้นทาง' });
    }),
  );
}

beforeEach(async () => {
  server = {
    state: createGame({ seed: 5, humans: [{ id: ME, name: 'อาณาจักรนที' }] }),
    version: 0,
    calls: [],
    conflict: false,
  };
  install();
  useStore.setState({ mode: 'local', session: null, socket: null, version: 0, inFlight: 0, modals: [] });
  await useStore.getState().goOnline(5);
  useStore.setState({ modals: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({ mode: 'local', session: null, socket: null, version: 0, inFlight: 0 });
});

describe('store โหมด server', () => {
  it('goOnline สร้างเกมบน server แล้วใช้ view จาก server', () => {
    const s = useStore.getState();
    expect(s.mode).toBe('server');
    expect(s.session).toMatchObject({ gameId: GAME_ID, factionId: ME });
    expect(s.version).toBe(0);
    expect(s.state.rng).toBe(0);
    expect(s.state.turn).toBe(1);
  });

  it('อัปเดตหน้าจอทันทีแล้ว reconcile version ตามที่ server ตอบ', async () => {
    const army = armiesOf(useStore.getState().state, ME)[0]!;
    const accepted = useStore.getState().dispatch({ type: 'camp', armyId: army.id });

    expect(accepted).toBe(true);
    // optimistic: เห็นผลก่อน server ตอบ
    expect(armiesOf(useStore.getState().state, ME)[0]!.mp).toBe(0);
    expect(useStore.getState().version).toBe(0);

    await vi.waitFor(() => expect(useStore.getState().version).toBe(1));
    expect(useStore.getState().inFlight).toBe(0);
    expect(armiesOf(useStore.getState().state, ME)[0]!.morale).toBe(armiesOf(server.state, ME)[0]!.morale);
  });

  it('ไม่ส่งคำสั่งที่ engine ในเครื่องบอกว่าทำไม่ได้', () => {
    const before = server.calls.length;
    const accepted = useStore.getState().dispatch({ type: 'annex', target: 'north' });
    expect(accepted).toBe(false);
    expect(server.calls.length).toBe(before);
    expect(useStore.getState().toast).toContain('ความสัมพันธ์');
  });

  it('รอ server ตอบก่อนสำหรับคำสั่งที่มีการสุ่ม เช่น endTurn', async () => {
    const accepted = useStore.getState().dispatch({ type: 'endTurn' });
    expect(accepted).toBe(true);
    expect(useStore.getState().state.turn).toBe(1);

    await vi.waitFor(() => expect(useStore.getState().version).toBe(1));
    expect(useStore.getState().state.turn).toBe(2);
    expect(useStore.getState().modals.some((m) => m.kind === 'season')).toBe(true);
  });

  it('เจอ 409 แล้วรับสถานะล่าสุดจาก server มาใช้', async () => {
    // server เดินไปข้างหน้าเองหนึ่งก้าว (เช่นผู้เล่นอื่นสั่ง)
    const other = applyAction(server.state, ME, { type: 'camp', armyId: armiesOf(server.state, ME)[0]!.id });
    if (!other.ok) throw new Error('setup ไม่สำเร็จ');
    server.state = other.state;
    server.version = 5;
    server.conflict = true;

    const army = armiesOf(useStore.getState().state, ME)[0]!;
    useStore.getState().dispatch({ type: 'move', armyId: army.id, c: army.c, r: army.r + 1 });

    await vi.waitFor(() => expect(useStore.getState().version).toBe(5));
    expect(useStore.getState().toast).toContain('สถานะเกมเปลี่ยนไปแล้ว');
    expect(armiesOf(useStore.getState().state, ME)[0]!.mp).toBe(0);
  });

  it('applyServer ข้ามเฟรมที่ version เก่ากว่าที่มีอยู่', () => {
    useStore.setState({ version: 4 });
    const stale = createGame({ seed: 999, humans: [{ id: ME }] });
    useStore.getState().applyServer(3, stale, []);
    expect(useStore.getState().version).toBe(4);
    expect(useStore.getState().state).not.toBe(stale);
  });

  it('goOffline กลับมาเล่นในเครื่องและลบ session', async () => {
    useStore.getState().goOffline();
    await vi.waitFor(() => expect(useStore.getState().mode).toBe('local'));
    expect(useStore.getState().session).toBeNull();
    expect(localStorage.getItem('siam-online-session')).toBeNull();
  });
});
