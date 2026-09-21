import type { GameEvent, GameState } from '@siam/engine';
import { wsUrl } from './client';

export type Connection = 'offline' | 'connecting' | 'online';

export type ServerFrame =
  | { type: 'sync'; gameId: string; factionId: string; version: number; seq: number; view: GameState }
  | {
      type: 'update';
      gameId: string;
      factionId: string;
      version: number;
      seq: number;
      view: GameState;
      events: GameEvent[];
    }
  | { type: 'pong' }
  | { type: 'error'; error: string; message: string };

export interface SocketHandlers {
  onFrame: (frame: ServerFrame) => void;
  onStatus: (status: Connection) => void;
}

export interface GameSocket {
  close: () => void;
  resync: () => void;
}

const MAX_DELAY_MS = 15_000;

/**
 * ต่อ WebSocket ใหม่เองเมื่อสายหลุด แล้วขอ resync เพื่อไล่สถานะให้ทัน
 * ดึง access token ใหม่ทุกครั้งก่อนต่อ (ไม่ใช่แค่ตอนแรก) เพราะ Supabase token อายุสั้นและต่ออายุเอง
 */
export function connectGameSocket(gameId: string, handlers: SocketHandlers): GameSocket {
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (typeof WebSocket === 'undefined') {
      handlers.onStatus('offline');
      return;
    }
    handlers.onStatus('connecting');
    void wsUrl(gameId).then((url) => {
      if (stopped) return;
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
        handlers.onStatus('online');
      };
      ws.onmessage = (event: MessageEvent) => {
        try {
          handlers.onFrame(JSON.parse(String(event.data)) as ServerFrame);
        } catch {
          /* เฟรมที่อ่านไม่ออกก็ข้าม */
        }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        handlers.onStatus('offline');
        if (!stopped) schedule();
      };
      ws.onerror = () => {
        /* onclose จะตามมาเอง */
      };
    });
  };

  const schedule = () => {
    attempt += 1;
    timer = setTimeout(open, Math.min(MAX_DELAY_MS, 500 * 2 ** Math.min(attempt, 5)));
  };

  open();

  return {
    close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
      socket = null;
    },
    resync() {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resync' }));
    },
  };
}
