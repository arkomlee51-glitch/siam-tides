import { RESOURCES, SEASONS, computeIncome, seasonOf, upkeepOf, yearOf } from '@siam/engine';
import { ME, useStore } from '../store';
import { RES_ORDER, signed } from './format';
import type { ThemeMode } from '../theme';

export function Hud({ mode, onCycleTheme }: { mode: ThemeMode; onCycleTheme: () => void }) {
  const state = useStore((s) => s.state);
  const newGame = useStore((s) => s.newGame);
  const pushModal = useStore((s) => s.pushModal);
  const me = state.factions[ME]!;
  const season = seasonOf(state.turn);
  const income = computeIncome(state, me);
  const themeLabel = mode === 'auto' ? 'ธีมอัตโนมัติ' : mode === 'dark' ? 'ธีมมืด' : 'ธีมสว่าง';

  return (
    <header className="top">
      <div className="titlebar">
        <div>
          <h1>สยาม: กระแสแห่งราชอาณาจักร</h1>
          <p>บทไผ่ลู่ลม สิบปี สามฤดูต่อปี</p>
        </div>
        <div className="tbtns">
          <button className="btn icon" onClick={onCycleTheme}>
            {themeLabel}
          </button>
          <button className="btn icon" onClick={() => pushModal({ kind: 'intro' })}>
            วิธีเล่น
          </button>
          <button className="btn icon" onClick={() => newGame()}>
            เริ่มใหม่
          </button>
        </div>
      </div>

      <div className="band">
        {SEASONS.map((s) => (
          <div key={s.id} className={`s ${s.id === season.id ? 'on' : ''}`}>
            <span className="ic">{s.icon}</span>
            <div>
              <b>{s.name}</b>
              <span className="t">{s.tip}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="statusrow">
        <div className="turn">
          {state.ended
            ? 'จบรัชกาลแล้ว'
            : `ปีที่ ${yearOf(state.turn)} จาก 10, เทิร์น ${state.turn}/${state.maxTurn}`}
        </div>
        <div className="res">
          {RES_ORDER.map((k) => (
            <div
              className="chip"
              key={k}
              title={
                k === 'rice'
                  ? `${RESOURCES[k].name} (หักเสบียงทัพ ${upkeepOf(state, ME)})`
                  : RESOURCES[k].name
              }
            >
              <span>{RESOURCES[k].icon}</span>
              <span className="v">{me.res[k]}</span>
              <span className={`d ${income[k] < 0 ? 'neg' : ''}`}>{signed(income[k])}</span>
              <span className="lbl">{RESOURCES[k].name}</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
