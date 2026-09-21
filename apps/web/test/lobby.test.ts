import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, viewFor } from '@siam/engine';
import type { GameState } from '@siam/engine';

/** เหมือน serverStore.test.ts — mock ../src/api/supabase ทั้งก้อนกัน network จริงตอน ensureSession()/getAccessToken() */
vi.mock('../src/api/supabase', () => ({
  ensureSession: vi.fn().mockResolvedValue({ access_token: 'test-access-token' }),
  getAccessToken: vi.fn().mockResolvedValue('test-access-token'),
  currentUser: vi.fn().mockResolvedValue({ id: 'host-user', email: null, isAnonymous: true }),
  linkEmail: vi.fn(),
  signOut: vi.fn(),
  supabase: {},
}));

const { useStore } = await import('../src/store');

const CODE = 'ABCDEF';
const GAME_ID = '22222222-2222-4222-8222-222222222222';

interface FakeLobby {
  code: string;
  hostUserId: string;
  seed?: number;
  maxTurn?: number;
  seats: { userId: string; name: string }[];
  startedGameId: string | null;
}

let lobby: FakeLobby;
let gameState: GameState;

const respond = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? undefined : { 'content-type': 'application/json' },
  });

function install(): void {
  vi.stubGlobal('WebSocket', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/lobbies') && method === 'POST') {
        return respond(201, lobby);
      }
      if (url.endsWith(`/lobbies/${CODE}/join`) && method === 'POST') {
        const body = init?.body ? (JSON.parse(String(init.body)) as { name?: string }) : {};
        if (!lobby.seats.some((s) => s.userId === 'joiner-user')) {
          lobby.seats.push({ userId: 'joiner-user', name: body.name ?? 'ผู้เล่น' });
        }
        return respond(200, lobby);
      }
      if (url.endsWith(`/lobbies/${CODE}`) && method === 'GET') {
        return respond(200, lobby);
      }
      if (url.endsWith(`/lobbies/${CODE}/leave`) && method === 'POST') {
        return respond(204, null);
      }
      if (url.endsWith(`/lobbies/${CODE}/start`) && method === 'POST') {
        lobby = { ...lobby, startedGameId: GAME_ID };
        return respond(201, {
          gameId: GAME_ID,
          version: 0,
          seq: 0,
          factionId: 'p1',
          view: viewFor(gameState, 'p1'),
        });
      }
      if (url.endsWith(`/games/${GAME_ID}`) && method === 'GET') {
        return respond(200, {
          gameId: GAME_ID,
          version: 0,
          seq: 0,
          factionId: 'p2',
          view: viewFor(gameState, 'p2'),
        });
      }
      return respond(404, { error: 'NOT_FOUND', message: 'ไม่พบเส้นทาง' });
    }),
  );
}

beforeEach(() => {
  gameState = createGame({ seed: 5, humans: [{ id: 'p1' }, { id: 'p2' }] });
  lobby = {
    code: CODE,
    hostUserId: 'host-user',
    seats: [{ userId: 'host-user', name: 'เจ้าของห้อง' }],
    startedGameId: null,
  };
  install();
  useStore.setState({ mode: 'local', session: null, socket: null, lobby: null, lobbyBusy: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({ mode: 'local', session: null, socket: null, lobby: null, lobbyBusy: false });
});

describe('ห้องรอ (เฟส 5)', () => {
  it('createLobby เก็บห้องที่ server ตอบไว้ใน store', async () => {
    await useStore.getState().createLobby();
    expect(useStore.getState().lobby).toMatchObject({ code: CODE, hostUserId: 'host-user' });
    expect(useStore.getState().lobbyBusy).toBe(false);
  });

  it('joinLobby เพิ่มที่นั่งของผู้เล่นเข้าห้อง', async () => {
    await useStore.getState().joinLobby(CODE.toLowerCase());
    const l = useStore.getState().lobby;
    expect(l?.seats.map((s) => s.userId)).toEqual(['host-user', 'joiner-user']);
  });

  it('refreshLobby เจอ startedGameId แล้วสลับเข้าโหมด server อัตโนมัติ (กรณีเห็นว่า host เริ่มเกมจากที่อื่น)', async () => {
    await useStore.getState().createLobby();
    lobby = { ...lobby, startedGameId: GAME_ID };

    await useStore.getState().refreshLobby();

    expect(useStore.getState().lobby).toBeNull();
    expect(useStore.getState().mode).toBe('server');
    expect(useStore.getState().session).toMatchObject({ gameId: GAME_ID, factionId: 'p2' });
  });

  it('leaveLobby เคลียร์ห้องออกจาก store ทันทีไม่ต้องรอ server ตอบ', async () => {
    await useStore.getState().createLobby();
    await useStore.getState().leaveLobby();
    expect(useStore.getState().lobby).toBeNull();
  });

  it('startLobby (host) สลับเข้าโหมด server ทันทีด้วย view ของ p1', async () => {
    await useStore.getState().createLobby();
    await useStore.getState().startLobby();

    expect(useStore.getState().lobby).toBeNull();
    expect(useStore.getState().mode).toBe('server');
    expect(useStore.getState().session).toMatchObject({ gameId: GAME_ID, factionId: 'p1' });
    expect(useStore.getState().state.rng).toBe(0);
  });
});
