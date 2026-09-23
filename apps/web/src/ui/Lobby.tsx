import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useStore } from '../store';
import { currentUser } from '../api/supabase';

const MAX_SEATS = 4;

export function LobbyPanel({ onClose }: { onClose: () => void }) {
  const lobby = useStore((s) => s.lobby);
  const lobbyBusy = useStore((s) => s.lobbyBusy);
  const createLobby = useStore((s) => s.createLobby);
  const joinLobby = useStore((s) => s.joinLobby);
  const startLobby = useStore((s) => s.startLobby);
  const [code, setCode] = useState('');
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [timerMinutes, setTimerMinutes] = useState(0);

  useEffect(() => {
    void currentUser().then((u) => setMyUserId(u?.id ?? null));
  }, []);

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length !== 6 || lobbyBusy) return;
    void joinLobby(code);
  };

  if (!lobby) {
    return (
      <>
        <div className="mhead">
          <span className="big">🧑‍🤝‍🧑</span>
          <div>
            <small>เล่นหลายคน (เฟส 5)</small>
            <h2>สร้างห้องหรือใส่รหัสเชิญ</h2>
          </div>
        </div>
        <p className="hint">
          ชวนเพื่อนได้สูงสุด {MAX_SEATS} คน แต่ละคนได้แคว้นของตัวเอง ที่นั่งที่เหลือเป็น AI
        </p>
        <label className="acct-form">
          <span className="muted small">จำกัดเวลาต่อฤดู (นาที, 0 = ไม่จำกัด)</span>
          <input
            className="acct-input"
            type="number"
            min={0}
            max={10080}
            step={1}
            value={timerMinutes}
            onChange={(e) => setTimerMinutes(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          />
        </label>
        <div className="mbtns">
          <button
            className="btn"
            disabled={lobbyBusy}
            onClick={() => void createLobby(timerMinutes > 0 ? timerMinutes * 60 : undefined)}
          >
            สร้างห้องใหม่
          </button>
        </div>
        <form className="acct-form" onSubmit={submitJoin}>
          <input
            className="acct-input lobby-code-input"
            placeholder="รหัสห้อง 6 หลัก"
            value={code}
            maxLength={6}
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button className="btn sm" type="submit" disabled={lobbyBusy || code.trim().length !== 6}>
            เข้าร่วม
          </button>
        </form>
        <div className="mbtns">
          <button className="btn ghost" onClick={onClose}>
            ปิด
          </button>
        </div>
      </>
    );
  }

  const isHost = myUserId !== null && lobby.hostUserId === myUserId;
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => lobby.seats[i] ?? null);

  return (
    <>
      <div className="mhead">
        <span className="big">🧑‍🤝‍🧑</span>
        <div>
          <small>ห้องรอ</small>
          <h2>รหัสห้อง {lobby.code}</h2>
        </div>
      </div>
      <p className="hint">
        ส่งรหัสนี้ให้เพื่อน — เข้าร่วมได้สูงสุด {MAX_SEATS} คน ({lobby.seats.length}/{MAX_SEATS} คนแล้ว)
      </p>
      <ul className="acct-games lobby-seats">
        {seats.map((seat, i) => (
          <li key={i} className={seat ? '' : 'empty'}>
            <div>
              <b>{seat ? seat.name : `ที่นั่งว่าง (AI)`}</b>
              {seat && seat.userId === lobby.hostUserId && <small>เจ้าของห้อง</small>}
            </div>
            {seat && seat.userId === myUserId && <small>คุณ</small>}
          </li>
        ))}
      </ul>
      <div className="mbtns">
        {isHost ? (
          <button className="btn" disabled={lobbyBusy} onClick={() => void startLobby()}>
            เริ่มเกม ({lobby.seats.length} คน{lobby.seats.length < MAX_SEATS ? ' + AI ที่เหลือ' : ''})
          </button>
        ) : (
          <p className="muted small">รอเจ้าของห้องกดเริ่มเกม…</p>
        )}
        <button className="btn ghost" onClick={onClose}>
          {isHost ? 'ยกเลิกห้อง' : 'ออกจากห้อง'}
        </button>
      </div>
    </>
  );
}
