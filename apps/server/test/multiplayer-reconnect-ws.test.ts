import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { GameState } from '@siam/engine';
import { armyOf, idemKey, makeApp, submit } from './helpers.js';

let app: FastifyInstance | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await app?.close();
  app = undefined;
});

interface Frame {
  type: string;
  version?: number;
  view?: GameState;
  [key: string]: unknown;
}

async function connect(
  instance: FastifyInstance,
  url: string,
): Promise<{ socket: WebSocket; frames: Frame[] }> {
  const frames: Frame[] = [];
  const socket = (await instance.injectWS(url, undefined, {
    onInit: (ws) => {
      ws.on('message', (raw: unknown) => {
        try {
          frames.push(JSON.parse(String(raw)) as Frame);
        } catch {
          /* ไม่ใช่ JSON ก็ข้าม */
        }
      });
    },
  })) as unknown as WebSocket;
  sockets.push(socket);
  return { socket, frames };
}

async function waitFor<T>(get: () => T | undefined, label: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = get();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`รอ ${label} นานเกินไป`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface LobbyBody {
  code: string;
  seats: { userId: string; name: string }[];
}
interface CreatedGame {
  gameId: string;
  version: number;
  factionId: string;
  view: GameState;
}

const createLobby = (instance: FastifyInstance, userId: string, payload: Record<string, unknown> = {}) =>
  instance.inject({
    method: 'POST',
    url: '/lobbies',
    headers: { authorization: `Bearer ${userId}` },
    payload,
  });

const joinLobby = (instance: FastifyInstance, code: string, userId: string) =>
  instance.inject({
    method: 'POST',
    url: `/lobbies/${code}/join`,
    headers: { authorization: `Bearer ${userId}` },
    payload: {},
  });

const startLobby = (instance: FastifyInstance, code: string, userId: string) =>
  instance.inject({
    method: 'POST',
    url: `/lobbies/${code}/start`,
    headers: { authorization: `Bearer ${userId}` },
  });

/** ห้องรอ 4 คน (เต็มที่นั่งมนุษย์) แล้วเริ่มเกม — จำลองสถานการณ์ "4 คนพร้อมกัน" ตามเกณฑ์เสร็จของเฟส 5 */
async function startFourHumanGame(
  instance: FastifyInstance,
  opts: Record<string, unknown> = {},
): Promise<{ gameId: string; users: [string, string, string, string] }> {
  const created = (await createLobby(instance, 'u1', opts)).json() as LobbyBody;
  await joinLobby(instance, created.code, 'u2');
  await joinLobby(instance, created.code, 'u3');
  await joinLobby(instance, created.code, 'u4');
  const started = (await startLobby(instance, created.code, 'u1')).json() as CreatedGame;
  return { gameId: started.gameId, users: ['u1', 'u2', 'u3', 'u4'] };
}

describe('WebSocket หลายคนพร้อมกัน — ต่อ, สายหลุด, ต่อใหม่', () => {
  it('4 คนต่อ WS พร้อมกันได้ แต่ละคนได้ sync เป็น view ของตัวเอง แล้วทุกคนเห็น update เดียวกันเมื่อมีคนสั่งการ', async () => {
    app = await makeApp();
    const { gameId, users } = await startFourHumanGame(app, { seed: 5 });

    const conns = await Promise.all(
      users.map((u, i) =>
        connect(app!, `/games/${gameId}/ws?token=${u}`).then((c) => ({ ...c, faction: `p${i + 1}` })),
      ),
    );
    for (const c of conns) {
      const sync = await waitFor(() => c.frames.find((f) => f.type === 'sync'), `sync ของ ${c.faction}`);
      expect(sync).toMatchObject({ version: 0, factionId: c.faction });
    }

    // u1 (p1) camp — ทุกคนต้องได้ update ทางเดียวกัน แม้ไม่ใช่คนสั่งเอง
    const army = armyOf(conns[0]!.frames.find((f) => f.type === 'sync')!.view!, 'p1');
    const res = await submit(app, { gameId }, 'u1', {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('ws4-camp'),
    });
    expect(res.statusCode).toBe(200);

    for (const c of conns) {
      const update = await waitFor(
        () => c.frames.find((f) => f.type === 'update'),
        `update ของ ${c.faction}`,
      );
      expect(update.version).toBe(1);
    }
  });

  it('คนหนึ่งสายหลุดกลางฤดู คนอื่นเล่นต่อจนฤดูเปลี่ยน แล้วคนที่หลุดต่อ WS ใหม่ต้องได้ state ล่าสุดที่ถูกต้อง ไม่ใช่ของเก่า', async () => {
    app = await makeApp();
    const { gameId, users } = await startFourHumanGame(app, { seed: 6 });
    const [u1, u2, u3, u4] = users;

    const c2 = await connect(app, `/games/${gameId}/ws?token=${u2}`);
    await waitFor(() => c2.frames.find((f) => f.type === 'sync'), 'sync ของ p2 ก่อนหลุด');

    // p2 "สายหลุด" — ปิด socket แต่ยังไม่ endTurn (เหมือนแอปพลิเคชันถูกปิด/เน็ตหลุดกลางฤดู)
    c2.socket.close();

    // อีกสามคนกด endTurn — p2 ยังไม่พร้อม ฤดูยังไม่ควรข้าม
    const endTurn = (userId: string, expectedVersion: number) =>
      submit(app!, { gameId }, userId, {
        action: { type: 'endTurn' },
        expectedVersion,
        idempotencyKey: idemKey(`ws4-end-${userId}`),
      });
    await endTurn(u1, 0);
    await endTurn(u3, 1);
    const beforeP2 = await endTurn(u4, 2);
    expect((beforeP2.json().view as GameState).turn).toBe(1); // p2 ยังไม่ ready — ฤดูยังไม่ข้าม

    // p2 กลับมา ต่อ WS ใหม่ (คนละ connection จากเดิม จำลองแอปเปิดใหม่/เน็ตกลับมา)
    const c2Again = await connect(app, `/games/${gameId}/ws?token=${u2}`);
    const resync = await waitFor(
      () => c2Again.frames.find((f) => f.type === 'sync'),
      'sync ของ p2 หลังต่อใหม่',
    );
    expect(resync.factionId).toBe('p2');
    expect(resync.version).toBe(3); // เห็นคำสั่งทั้งสามที่เกิดระหว่างหลุดสายครบ ไม่ตกหล่น
    expect((resync.view as GameState).turn).toBe(1);
    expect((resync.view as GameState).ready).toEqual(expect.arrayContaining(['p1', 'p3', 'p4']));

    // p2 กด endTurn เองหลังต่อกลับมา — ฤดูต้องข้ามแล้ว (ครบทั้ง 4 คนจริง ๆ)
    const p2Ends = await endTurn(u2, 3);
    expect(p2Ends.statusCode).toBe(200);
    expect((p2Ends.json().view as GameState).turn).toBe(2);

    // connection เดิมที่ปิดไปแล้วต้องไม่ได้รับ update อะไรอีก (ปิดสายจริง ไม่ใช่ค้างอยู่เงียบ ๆ)
    expect(c2.frames.filter((f) => f.type === 'update')).toHaveLength(0);
  });

  it('resync ระหว่างสายยังไม่หลุด (แค่ขอสถานะล่าสุดใหม่) ก็ได้ view ที่ถูกต้องเหมือนกัน', async () => {
    app = await makeApp();
    const { gameId, users } = await startFourHumanGame(app, { seed: 7 });
    const [u1, u2] = users;

    const c1 = await connect(app, `/games/${gameId}/ws?token=${u1}`);
    await waitFor(() => c1.frames.find((f) => f.type === 'sync'), 'sync แรกของ p1');

    // p2 สั่งการระหว่างที่ p1 อาจพลาด event (จำลองแพ็กเก็ตตกหล่นสั้น ๆ ไม่ถึงกับสายหลุดเต็ม ๆ)
    const army = armyOf(c1.frames[0]!.view!, 'p2');
    await submit(app, { gameId }, u2, {
      action: { type: 'camp', armyId: army.id },
      expectedVersion: 0,
      idempotencyKey: idemKey('ws4-resync'),
    });

    c1.socket.send(JSON.stringify({ type: 'resync' }));
    const synced = await waitFor(
      () => c1.frames.filter((f) => f.type === 'sync').find((f) => f.version === 1),
      'sync หลัง resync',
    );
    expect(synced.factionId).toBe('p1');
    expect((synced.view as GameState).armies.find((a) => a.id === army.id)?.mp).toBe(0);
  });
});
