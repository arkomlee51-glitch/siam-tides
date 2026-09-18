const KEY = 'siam-online-session';

export interface OnlineSession {
  gameId: string;
  factionId: string;
  /** player token ที่ server ออกให้ตอนสร้างเกม (เฟส 4 จะเปลี่ยนเป็น Supabase JWT) */
  token: string;
}

export function loadSession(): OnlineSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnlineSession>;
    if (!parsed.gameId || !parsed.factionId || !parsed.token) return null;
    return { gameId: parsed.gameId, factionId: parsed.factionId, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveSession(session: OnlineSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* โหมดส่วนตัวของเบราว์เซอร์อาจเขียนไม่ได้ ไม่ใช่เรื่องร้ายแรง */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ไม่เป็นไร */
  }
}
