import type { FastifyInstance } from 'fastify';
import { tokenFrom } from '../auth.js';
import { AppError } from '../errors.js';
import { GameParams, WsQuery } from '../schemas.js';

const HEARTBEAT_MS = 30_000;

/**
 * `GET /games/:id/ws?token=...`
 * subscribe ก่อนแล้วจึงส่ง `sync` เพื่อไม่ให้พลาด update ที่เกิดระหว่างเชื่อมต่อ
 * หลังจากนั้น push `update` ทุกครั้งที่มีคำสั่งถูกใช้ (ผ่าน pub/sub ของ store)
 * เบราว์เซอร์ตั้ง header ของ WebSocket ไม่ได้ จึงรับ token จาก query string ได้ด้วย
 */
export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/games/:id/ws', { websocket: true }, async (socket, request) => {
    const send = (payload: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };
    const fail = (error: string, message: string) => {
      send({ type: 'error', error, message });
      socket.close(1008, error);
    };

    let closed = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    const heartbeat = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, HEARTBEAT_MS);
    socket.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      void unsubscribe?.();
    });

    const params = GameParams.safeParse(request.params);
    const query = WsQuery.safeParse(request.query);
    if (!params.success || !query.success) {
      fail('BAD_REQUEST', 'พารามิเตอร์ไม่ถูกต้อง');
      return;
    }
    const gameId = params.data.id;

    let factionId: string;
    try {
      const auth = await app.games.authenticate(gameId, tokenFrom(request));
      factionId = auth.factionId;
    } catch (err) {
      const body =
        err instanceof AppError ? err.toBody() : { error: 'INTERNAL', message: 'เชื่อมต่อไม่สำเร็จ' };
      fail(body.error, body.message);
      return;
    }

    unsubscribe = await app.store.subscribe(gameId, (update) => {
      try {
        send({
          type: 'update',
          gameId,
          factionId,
          version: update.version,
          seq: update.seq,
          view: app.games.viewOf(update.state, factionId),
          events: app.games.eventsOf(update.events, factionId),
        });
      } catch (err) {
        request.log.error({ err, gameId }, 'ส่ง update ทาง WebSocket ไม่สำเร็จ');
      }
    });
    if (closed) {
      void unsubscribe();
      return;
    }

    // อ่าน snapshot หลัง subscribe แล้ว: update ที่มาทีหลังจะมี version สูงกว่าเสมอ
    send({ type: 'sync', ...(await app.games.view(gameId, factionId)) });

    socket.on('message', (raw: unknown) => {
      let message: { type?: unknown };
      try {
        message = JSON.parse(String(raw)) as { type?: unknown };
      } catch {
        return;
      }
      if (message.type === 'ping') send({ type: 'pong' });
      if (message.type === 'resync') {
        void app.games
          .view(gameId, factionId)
          .then((snapshot) => send({ type: 'sync', ...snapshot }))
          .catch(() => send({ type: 'error', error: 'NOT_FOUND', message: 'ไม่พบเกมนี้' }));
      }
    });
  });
}
