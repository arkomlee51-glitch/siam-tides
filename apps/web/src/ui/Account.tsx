import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useStore } from '../store';
import { currentUser, linkEmail, supabase } from '../api/supabase';

interface GamePlayerJoinRow {
  game_id: string;
  faction_id: string;
  seat: string;
  name: string;
  ending: string | null;
  /** ไม่ได้ตั้ง generated Database types ให้ client ฝั่ง web — postgrest-js เลยคืน relation แบบ array ที่ไม่ทราบ cardinality */
  games: { status: 'lobby' | 'active' | 'finished'; created_at: string; finished_at: string | null }[];
}

interface MyGameRow {
  gameId: string;
  factionId: string;
  name: string;
  ending: string | null;
  status: 'lobby' | 'active' | 'finished';
}

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const resumeOnline = useStore((s) => s.resumeOnline);

  const [identity, setIdentity] = useState<{ email: string | null; isAnonymous: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [games, setGames] = useState<MyGameRow[] | null>(null);

  useEffect(() => {
    void currentUser().then((u) => setIdentity(u ? { email: u.email, isAnonymous: u.isAnonymous } : null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from('game_players')
      .select('game_id, faction_id, seat, name, ending, games(status, created_at, finished_at)')
      .order('joined_at', { ascending: false })
      .limit(20)
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setError(queryError.message);
          return;
        }
        const rows = (data as GamePlayerJoinRow[] | null) ?? [];
        setGames(
          rows.map((r) => ({
            gameId: r.game_id,
            factionId: r.faction_id,
            name: r.name,
            ending: r.ending,
            status: r.games[0]?.status ?? 'active',
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await linkEmail(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="mhead">
        <span className="big">👤</span>
        <div>
          <small>บัญชี</small>
          <h2>{identity?.email ?? 'ผู้เล่นไม่ระบุตัวตน'}</h2>
        </div>
      </div>

      {!identity?.email && (
        <>
          <p className="hint">
            ผูกอีเมลไว้เพื่อเล่นต่อจากเครื่องอื่นได้ — เกมและเซฟปัจจุบันจะยังอยู่เหมือนเดิม
          </p>
          <form className="acct-form" onSubmit={(e) => void submitEmail(e)}>
            <input
              className="acct-input"
              type="email"
              required
              placeholder="อีเมลของคุณ"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="btn sm" type="submit" disabled={sending}>
              {sending ? 'กำลังส่ง…' : 'ส่งลิงก์ยืนยัน'}
            </button>
          </form>
          {sent && <p className="hint good">ส่งลิงก์ไปที่อีเมลแล้ว กดลิงก์ในอีเมลเพื่อยืนยันบัญชี</p>}
        </>
      )}
      {error && <p className="hint bad">{error}</p>}

      <h3>เกมของฉัน</h3>
      {games === null && <p className="muted small">กำลังโหลด…</p>}
      {games !== null && games.length === 0 && (
        <p className="muted small">
          ยังไม่มีเกมที่เล่นผ่าน server — กด &ldquo;เล่นผ่าน server&rdquo; ที่แถบด้านบนเพื่อเริ่ม
        </p>
      )}
      {games !== null && games.length > 0 && (
        <ul className="acct-games">
          {games.map((g) => (
            <li key={`${g.gameId}:${g.factionId}`}>
              <div>
                <b>{g.name}</b>
                <small>
                  {g.status === 'finished' ? 'จบแล้ว' : g.status === 'lobby' ? 'ห้องรอ' : 'กำลังเล่น'}
                </small>
              </div>
              <button
                className="btn sm"
                onClick={() => {
                  void resumeOnline(g.gameId);
                  onClose();
                }}
              >
                เล่นต่อ
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mbtns">
        <button className="btn ghost" onClick={onClose}>
          ปิด
        </button>
      </div>
    </>
  );
}
