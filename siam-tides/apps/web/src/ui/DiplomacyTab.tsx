import { COSTS, RULES, aiFactions, canPay, relation, seasonOf } from '@siam/engine';
import { ME, useStore } from '../store';
import { costText, seasonalCostOf } from './format';

export function DiplomacyTab() {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const pushModal = useStore((s) => s.pushModal);
  const me = state.factions[ME]!;
  const diplo = seasonOf(state.turn).diplo;
  const alive = aiFactions(state);
  const dead = state.order.map((id) => state.factions[id]!).filter((f) => f.kind === 'ai' && !f.alive);

  const cost = (base: Parameters<typeof costText>[0]) => seasonalCostOf(state, base, 'diplo');

  return (
    <>
      <p className="muted small">
        ค่าใช้จ่ายการทูตฤดูนี้ ×{diplo}
        {diplo < 1 ? ' ฤดูร้อนเหมาะกับการเจรจา' : ''}
      </p>
      {alive.map((f) => {
        const rel = relation(state, f.id, ME);
        const tribute = cost(COSTS.tribute);
        const festival = cost(COSTS.festival);
        const annex = cost(COSTS.annex);
        const peace = cost(COSTS.peace);
        return (
          <div className="card" key={f.id}>
            <div className="ch">
              <span className="sw" style={{ background: `var(--own-${f.colorToken})` }} />
              <h3>{f.name}</h3>
              <span className={`badge ${rel.war ? 'bad' : 'ok'}`}>{rel.war ? 'สงคราม' : 'สงบ'}</span>
            </div>
            <div className="rel">
              <div className="track" title="ขีดจางคือระดับที่ผนวกได้">
                <i style={{ left: `${(rel.rel + 100) / 2}%` }} />
                <em style={{ left: `${(RULES.annexThreshold + 100) / 2}%` }} />
              </div>
              <span>{rel.rel}</span>
            </div>
            <div className="btns">
              {rel.war ? (
                <button
                  className="btn"
                  disabled={!canPay(me.res, peace)}
                  onClick={() => dispatch({ type: 'offerPeace', target: f.id })}
                >
                  🕊️ เสนอสงบศึก <small>{costText(peace)}, สำเร็จราว 65%</small>
                </button>
              ) : (
                <>
                  <button
                    className="btn"
                    disabled={!canPay(me.res, tribute)}
                    onClick={() => dispatch({ type: 'tribute', target: f.id })}
                  >
                    🎁 ส่งบรรณาการ{' '}
                    <small>
                      {costText(tribute)}, สัมพันธ์ +{RULES.tributeGain}
                    </small>
                  </button>
                  <button
                    className="btn"
                    disabled={!canPay(me.res, festival)}
                    onClick={() => dispatch({ type: 'festival', target: f.id })}
                  >
                    🪷 จัดงานบุญร่วมกัน{' '}
                    <small>
                      {costText(festival)}, สัมพันธ์ +{RULES.festivalGain}
                    </small>
                  </button>
                  <button
                    className="btn good"
                    disabled={rel.rel < RULES.annexThreshold || !canPay(me.res, annex)}
                    onClick={() => dispatch({ type: 'annex', target: f.id })}
                  >
                    🤝 ผนวกโดยสันติ{' '}
                    <small>
                      {costText(annex)}, ต้องมีสัมพันธ์ {RULES.annexThreshold}
                    </small>
                  </button>
                  <button
                    className="btn danger"
                    onClick={() =>
                      pushModal({
                        kind: 'confirm',
                        title: `ประกาศสงครามกับ${f.name}?`,
                        body: 'ความสัมพันธ์จะลดเหลือไม่เกิน −60 เสถียรภาพ −5 และแคว้นอื่นจะไม่พอใจ สงครามยังลดเสถียรภาพ 2 ทุกฤดูจนกว่าจะสงบศึก',
                        confirmLabel: 'ประกาศสงคราม',
                        danger: true,
                        action: { type: 'declareWar', target: f.id },
                      })
                    }
                  >
                    ⚔️ ประกาศสงคราม
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {dead.map((f) => (
        <div className="card dim" key={f.id}>
          <div className="ch">
            <span className="sw" style={{ background: `var(--own-${f.colorToken})` }} />
            <h3>{f.name}</h3>
          </div>
          <p className="muted small">ไม่เหลืออยู่ในฐานะรัฐอิสระแล้ว</p>
        </div>
      ))}
    </>
  );
}
