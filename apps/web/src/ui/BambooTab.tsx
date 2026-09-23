import { canPay, offeringPower, seasonOf, yearOf } from '@siam/engine';
import type { ChapterRulesData, PowerId } from '@siam/engine';
import { ME, useStore } from '../store';
import { chapterOf, costText, seasonalCostOf } from './format';

function zone(meter: number, R: ChapterRulesData): { label: string; tone: string; note: string } {
  const am = Math.abs(meter);
  if (am <= R.balancedZone)
    return {
      label: 'สมดุล',
      tone: 'good',
      note: `ได้ความรู้ +${R.balancedKnowBonus} ทุกฤดู ถ้าทุกฝ่ายยังมีความอดทนอย่างน้อย 2`,
    };
  if (am <= R.dangerZone)
    return { label: 'เอนเอียง', tone: 'warn', note: 'ยังปลอดภัย แต่ฝ่ายหนึ่งเริ่มมีเสียงดังในราชสำนัก' };
  return { label: 'อันตราย', tone: 'bad', note: 'เสียเอกราช 4 ทุกฤดู' };
}

const LEAVES: [number, number][] = [
  [-14, -8],
  [12, -12],
  [-10, 18],
  [14, 10],
  [-12, 42],
  [10, 36],
];

export function BambooTab() {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const me = state.factions[ME]!;
  const chapter = chapterOf(state);
  const R = chapter.rules;
  const powers = chapter.foreignPowers;
  const powerIds = Object.keys(powers) as PowerId[];
  // the bamboo meter is two-ended by design (−100..+100); each power pulls toward its `side`
  const leftSide = powerIds.filter((id) => powers[id]!.side < 0).map((id) => powers[id]!);
  const rightSide = powerIds.filter((id) => powers[id]!.side > 0).map((id) => powers[id]!);
  const z = zone(me.meter, R);
  const envoy = seasonalCostOf(state, chapter.costs.envoy ?? {}, 'diplo');
  const thisYear = offeringPower(chapter, yearOf(state.turn));
  const next = offeringPower(chapter, yearOf(state.turn) + 1);
  const upcoming =
    seasonOf(state.turn).id === 'hot'
      ? `ฤดูร้อนปีหน้า ${powers[next]!.name}จะยื่นข้อเสนอ`
      : `ฤดูร้อนนี้ ${powers[thisYear]!.name}จะยื่นข้อเสนอ`;

  return (
    <>
      <div className="card">
        <h3>แถบไผ่ลู่ลม</h3>
        <svg className="bamboo" viewBox="0 0 220 130" aria-hidden="true">
          <line x1="10" y1="119" x2="210" y2="119" stroke="var(--line)" strokeWidth="2" />
          <text x="8" y="22" fontSize="20">
            {leftSide.map((p) => p.icon).join('')}
          </text>
          <text x="188" y="22" fontSize="20">
            {rightSide.map((p) => p.icon).join('')}
          </text>
          <g className="stalk" style={{ transform: `rotate(${(me.meter * 0.4).toFixed(1)}deg)` }}>
            <path d="M110 118 L110 14" stroke="var(--good)" strokeWidth="7" strokeLinecap="round" />
            {[96, 72, 48, 26].map((y) => (
              <line
                key={y}
                x1="104"
                y1={y}
                x2="116"
                y2={y}
                stroke="var(--ink)"
                strokeOpacity=".45"
                strokeWidth="2"
              />
            ))}
            {LEAVES.map(([dx, dy], i) => (
              <ellipse
                key={i}
                cx={110 + dx}
                cy={22 + dy}
                rx="12"
                ry="3.6"
                transform={`rotate(${dx > 0 ? -25 : 25} ${110 + dx} ${22 + dy})`}
                fill="var(--good)"
                opacity={0.85 - i * 0.08}
              />
            ))}
          </g>
        </svg>
        <div className="mtrack" aria-label={`ค่าแถบไผ่ ${me.meter}`}>
          <i style={{ left: `${(me.meter + 100) / 2}%` }} />
        </div>
        <div className="mlabels">
          <span>{leftSide.map((p) => `${p.icon} ${p.name}`).join(' / ')}</span>
          <span>{rightSide.map((p) => `${p.name} ${p.icon}`).join(' / ')}</span>
        </div>
        <p>
          <span className={`badge ${z.tone}`}>
            {z.label} {me.meter > 0 ? '+' : ''}
            {me.meter}
          </span>{' '}
          {z.note}
        </p>
        <p className="muted small">
          เคยเอียงเกิน ±{R.dangerZone} มาแล้ว {me.extremeTurns} ฤดู ครบ {R.extremeLimit}{' '}
          ฤดูจะได้ตอนจบใต้ร่มเงา แถบจะคืนเข้าหากลางทีละ 1 ทุกฤดู
        </p>
      </div>
      <p className="small">{upcoming} ปฏิเสธบ่อยจนความอดทนหมด จะเจอคำขาดเรือปืน</p>
      {powerIds.map((pid) => (
        <div className="card" key={pid}>
          <div className="ch">
            <span style={{ fontSize: 22 }}>{powers[pid]!.icon}</span>
            <h3>{powers[pid]!.name}</h3>
            <span className="pips" title="ความอดทน">
              {'●'.repeat(me.powers[pid].patience)}
              {'○'.repeat(Math.max(0, 4 - me.powers[pid].patience))}
            </span>
          </div>
          <div className="btns">
            <button
              className="btn"
              disabled={!canPay(me.res, envoy)}
              onClick={() => dispatch({ type: 'envoy', power: pid })}
            >
              ✉️ ส่งคณะทูต{' '}
              <small>
                {costText(envoy, chapter)}, ไผ่ {powers[pid]!.side < 0 ? '←' : '→'} {R.envoyMeter}, ความอดทน
                +1, 📜+{R.envoyKnow}
              </small>
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
