import { useEffect, useRef } from 'react';
import { ENDINGS, SEASONS, describeDecision, seasonLabel, seasonOf, yearOf } from '@siam/engine';
import type { GameEvent } from '@siam/engine';
import { ME, useStore } from '../store';
import { AccountPanel } from './Account';

function Shell({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal">
      <div className="mcard" role="dialog" aria-modal="true" ref={ref}>
        {children}
      </div>
    </div>
  );
}

const EventList = ({ events }: { events: GameEvent[] }) =>
  events.length ? (
    <ul className="ev">
      {events.map((e, i) => (
        <li key={i} className={e.tone}>
          {e.text}
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">ฤดูกาลผ่านไปอย่างสงบ</p>
  );

export function Modals() {
  const state = useStore((s) => s.state);
  const modals = useStore((s) => s.modals);
  const closeModal = useStore((s) => s.closeModal);
  const confirmModal = useStore((s) => s.confirmModal);
  const dispatch = useStore((s) => s.dispatch);
  const newGame = useStore((s) => s.newGame);
  const modal = modals[0];
  const decision = state.pending.find((p) => p.faction === ME);

  if (!modal && decision) {
    const info = describeDecision(state, decision);
    return (
      <Shell>
        <div className="mhead">
          <span className="big">{info.powerIcon}</span>
          <div>
            <small>{info.powerName}</small>
            <h2>{info.title}</h2>
          </div>
        </div>
        <p>{info.text}</p>
        <div className="mbtns">
          {info.options.map((o) => (
            <button
              key={o.choice}
              className={`btn ${o.choice === 'decline' ? 'ghost' : ''} ${o.choice === 'yield' ? 'danger' : ''}`}
              disabled={!o.enabled}
              onClick={() => dispatch({ type: 'answerDecision', decisionId: info.id, choice: o.choice })}
            >
              {o.label}
              <small>{o.detail}</small>
            </button>
          ))}
        </div>
      </Shell>
    );
  }
  if (!modal) return null;

  if (modal.kind === 'intro')
    return (
      <Shell onClose={closeModal}>
        <div className="intro">
          <div className="mhead">
            <span className="big">🏞️</span>
            <div>
              <small>ต้นแบบบทไผ่ลู่ลม</small>
              <h2>ทุกสิ่งเริ่มจากการตัดสินใจครั้งแรกของคุณ</h2>
            </div>
          </div>
          <p>
            คุณปกครองกรุงนทีริมแม่น้ำ รอบข้างมีแคว้นอิสระสามแคว้น
            และมหาอำนาจทางทะเลสองฝ่ายที่ต่างอยากมีอิทธิพลเหนือราชสำนัก คุณมีเวลาสิบปี
          </p>
          <ol>
            <li>
              <b>หนึ่งเทิร์นคือหนึ่งฤดู</b> ฝน หนาว ร้อน วนไป ทุกอย่างทำได้ทุกฤดู แต่ต้นทุนและผลลัพธ์ต่างกัน
            </li>
            <li>
              <b>ข้าวได้มากที่สุดตอนหนาว</b> ซึ่งเป็นฤดูศึกด้วย ตุนเสบียงไว้ก่อนออกรบ
            </li>
            <li>
              <b>รวมแผ่นดินได้สองทาง</b> ผูกไมตรีจนผนวกโดยสันติ หรือประกาศสงครามแล้วยึดเมือง
            </li>
            <li>
              <b>รักษาแถบไผ่ให้สมดุล</b> เอนไปฝ่ายใดมากเกินไปจะเสียเอกราช
            </li>
          </ol>
          <p className="muted small">ดูเงื่อนไขตอนจบทั้งหกแบบได้ที่แท็บเป้าหมาย เกมเซฟอัตโนมัติทุกฤดู</p>
        </div>
        <div className="mbtns">
          <button className="btn" onClick={closeModal}>
            เริ่มรัชกาล
          </button>
        </div>
      </Shell>
    );

  if (modal.kind === 'season') {
    const season = SEASONS[(modal.turn - 1) % 3]!;
    return (
      <Shell onClose={closeModal}>
        <div className="mhead">
          <span className="big">{season.icon}</span>
          <div>
            <small>
              เทิร์น {modal.turn} จาก {state.maxTurn}, ปีที่ {yearOf(modal.turn)}
            </small>
            <h2>{season.name}</h2>
          </div>
        </div>
        <p>{season.tip}</p>
        <div className="smods">
          <span>เดินทัพ {season.move} แต้ม</span>
          <span>พลังบุก ×{season.atk}</span>
          <span>ข้าว ×{season.rice}</span>
          <span>ก่อสร้าง ×{season.build}</span>
          <span>การทูต ×{season.diplo}</span>
        </div>
        <h3>เกิดอะไรขึ้นในฤดูที่ผ่านมา</h3>
        <EventList events={modal.events} />
        <div className="mbtns">
          <button className="btn" onClick={closeModal}>
            ไปต่อ
          </button>
        </div>
      </Shell>
    );
  }

  if (modal.kind === 'battle')
    return (
      <Shell onClose={closeModal}>
        <div className="mhead">
          <span className="big">{modal.report.win ? '🏆' : '💥'}</span>
          <div>
            <small>รายงานศึกที่{modal.report.place}</small>
            <h2>{modal.report.win ? 'ชัยชนะ' : 'พ่ายแพ้'}</h2>
          </div>
        </div>
        <ul className="factors">
          {modal.report.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <div className="mbtns">
          <button className="btn" onClick={closeModal}>
            รับทราบ
          </button>
        </div>
      </Shell>
    );

  if (modal.kind === 'confirm')
    return (
      <Shell onClose={closeModal}>
        <div className="mhead">
          <span className="big">⚔️</span>
          <div>
            <small>ยืนยัน</small>
            <h2>{modal.title}</h2>
          </div>
        </div>
        <p>{modal.body}</p>
        <div className="mbtns">
          <button className={`btn ${modal.danger ? 'danger' : ''}`} onClick={confirmModal}>
            {modal.confirmLabel}
          </button>
          <button className="btn ghost" onClick={closeModal}>
            ยกเลิก
          </button>
        </div>
      </Shell>
    );

  if (modal.kind === 'account')
    return (
      <Shell onClose={closeModal}>
        <AccountPanel onClose={closeModal} />
      </Shell>
    );

  const me = state.factions[ME]!;
  const ending = ENDINGS[me.ending ?? 'survive'];
  const cities = state.cities.filter((c) => c.owner === ME).length;
  return (
    <Shell>
      <div className="mhead">
        <span className="big">{ending.icon}</span>
        <div>
          <small>ตอนจบ</small>
          <h2>{ending.name}</h2>
        </div>
      </div>
      <p>{ending.text}</p>
      <p className="muted small">เงื่อนไข: {ending.cond}</p>
      <h3>สรุปรัชกาล</h3>
      <div className="statsg">
        <span>เมืองที่ครอง</span>
        <b>
          {cities} จาก {state.cities.length}
        </b>
        <span>เอกราช</span>
        <b>{me.sovereignty}</b>
        <span>แถบไผ่ตอนจบ</span>
        <b>{me.meter}</b>
        <span>ความรู้สะสม</span>
        <b>{me.knowTotal}</b>
        <span>ศรัทธาสะสม</span>
        <b>{me.faithTotal}</b>
        <span>สู้รบ / ชนะ</span>
        <b>
          {me.stats.battles} / {me.stats.wins}
        </b>
        <span>ยึดเมือง / ผนวกแคว้น</span>
        <b>
          {me.stats.captures} / {me.stats.annexed}
        </b>
        <span>ข้อเสนอ ยอม / ต่อรอง / ปฏิเสธ</span>
        <b>
          {me.stats.accepted} / {me.stats.negotiated} / {me.stats.declined}
        </b>
      </div>
      <h3>ไทม์ไลน์รัชกาล</h3>
      <ul className="chron">
        {state.chronicle
          .filter((c) => c.faction === null || c.faction === ME)
          .map((c, i) => (
            <li key={i}>
              <span>{seasonLabel(Math.min(c.turn, state.maxTurn))}</span>
              {c.text}
            </li>
          ))}
      </ul>
      <div className="mbtns">
        <button className="btn" onClick={() => newGame()}>
          เล่นอีกครั้ง
        </button>
      </div>
    </Shell>
  );
}

export const currentSeasonName = (turn: number): string => seasonOf(turn).name;
