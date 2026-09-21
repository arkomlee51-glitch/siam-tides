const KEY = 'siam-online-session';

/** เฟส 4: token มาจาก Supabase session (สดใหม่เสมอ, ต่ออายุเอง) — เก็บไว้แค่ตัวชี้ว่ากำลังเล่นเกมไหน/ที่นั่งไหน */
export interface OnlineSession {
  gameId: string;
  factionId: string;
}

export function loadSession(): OnlineSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnlineSession>;
    if (!parsed.gameId || !parsed.factionId) return null;
    return { gameId: parsed.gameId, factionId: parsed.factionId };
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
