import { aiFactions, canPay, relation, seasonOf } from '@siam/engine';
import type { Cost } from '@siam/engine';
import { ME, useStore } from '../store';
import { chapterOf, costText as costTextIn, seasonalCostOf } from './format';

export function DiplomacyTab() {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const pushModal = useStore((s) => s.pushModal);
  const me = state.factions[ME]!;
  const diplo = seasonOf(state.turn).diplo;
  const alive = aiFactions(state);
  const dead = state.order.map((id) => state.factions[id]!).filter((f) => f.kind === 'ai' && !f.alive);
  const otherHumans = state.order
    .map((id) => state.factions[id]!)
    .filter((f) => f.kind === 'human' && f.id !== ME);
  const aliveHumans = otherHumans.filter((f) => f.alive);
  const deadHumans = otherHumans.filter((f) => !f.alive);

  const chapter = chapterOf(state);
  const R = chapter.rules;
  const costs = chapter.costs;
  const costText = (c: Cost) => costTextIn(c, chapter);
  const cost = (base: Cost | undefined) => seasonalCostOf(state, base ?? {}, 'diplo');

  return (
    <>
      {aliveHumans.length > 0 && (
        <>
          <p className="muted small">
            ผู้เล่นคนอื่น — สงบศึกและรวมแผ่นดินต้องให้อีกฝ่ายตอบรับเอง ไม่ใช่จ่ายเงินซื้อ
          </p>
          {aliveHumans.map((f) => {
            const rel = relation(state, f.id, ME);
            const outgoing = state.proposals.find(
              (p) => p.from === ME && p.to === f.id && p.kind === 'peace',
            );
            const incoming = state.proposals.find(
              (p) => p.from === f.id && p.to === ME && p.kind === 'peace',
            );
            const incomingUnion = state.proposals.find(
              (p) => p.from === f.id && p.to === ME && p.kind === 'union',
            );
            const outgoingUnion = state.proposals.find(
              (p) => p.from === ME && p.to === f.id && p.kind === 'union',
            );
            const tribute = cost(costs.tribute);
            const festival = cost(costs.festival);
            const annex = cost(costs.annex);
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
                    <em style={{ left: `${(R.annexThreshold + 100) / 2}%` }} />
                  </div>
                  <span>{rel.rel}</span>
                </div>
                <div className="btns">
                  {rel.war ? (
                    incoming ? (
                      <>
                        <p className="muted small">{f.name}เสนอสงบศึกกับคุณ</p>
                        <button
                          className="btn good"
                          onClick={() =>
                            dispatch({ type: 'answerProposal', proposalId: incoming.id, accept: true })
                          }
                        >
                          🕊️ ยอมรับ
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            dispatch({ type: 'answerProposal', proposalId: incoming.id, accept: false })
                          }
                        >
                          ปฏิเสธ
                        </button>
                      </>
                    ) : outgoing ? (
                      <button className="btn" disabled>
                        🕊️ เสนอสงบศึกแล้ว รอคำตอบจาก{f.name}
                      </button>
                    ) : (
                      <button
                        className="btn"
                        onClick={() => dispatch({ type: 'proposePeace', target: f.id })}
                      >
                        🕊️ เสนอสงบศึก
                      </button>
                    )
                  ) : (
                    <>
                      {incomingUnion ? (
                        <>
                          <p className="muted small">
                            {f.name}เสนอรวมแผ่นดินกับคุณ — ถ้ายอมรับ เมืองและทัพทั้งหมดของคุณจะเข้าร่วมกับ
                            {f.name} และคุณจะจบเกมด้วยตอนจบ "{chapter.endings['union']?.name ?? 'รวมแผ่นดิน'}"
                          </p>
                          <button
                            className="btn good"
                            onClick={() =>
                              pushModal({
                                kind: 'confirm',
                                title: `รวมแผ่นดินกับ${f.name}?`,
                                body: 'คุณจะออกจากเกมทันทีหลังยอมรับ ย้อนกลับไม่ได้',
                                confirmLabel: 'ยอมรับรวมแผ่นดิน',
                                danger: true,
                                action: {
                                  type: 'answerProposal',
                                  proposalId: incomingUnion.id,
                                  accept: true,
                                },
                              })
                            }
                          >
                            🤝 ยอมรับรวมแผ่นดิน
                          </button>
                          <button
                            className="btn"
                            onClick={() =>
                              dispatch({
                                type: 'answerProposal',
                                proposalId: incomingUnion.id,
                                accept: false,
                              })
                            }
                          >
                            ปฏิเสธ
                          </button>
                        </>
                      ) : null}
                      <button
                        className="btn"
                        disabled={!canPay(me.res, tribute)}
                        onClick={() => dispatch({ type: 'tribute', target: f.id })}
                      >
                        🎁 ส่งบรรณาการ{' '}
                        <small>
                          {costText(tribute)} (อีกฝ่ายได้รับจริง), สัมพันธ์ +{R.tributeGain}
                        </small>
                      </button>
                      <button
                        className="btn"
                        disabled={!canPay(me.res, festival)}
                        onClick={() => dispatch({ type: 'festival', target: f.id })}
                      >
                        🪷 จัดงานบุญร่วมกัน{' '}
                        <small>
                          {costText(festival)}, สัมพันธ์ +{R.festivalGain}
                        </small>
                      </button>
                      {outgoingUnion ? (
                        <button className="btn" disabled>
                          🤝 เสนอรวมแผ่นดินแล้ว รอคำตอบจาก{f.name}
                        </button>
                      ) : (
                        <button
                          className="btn good"
                          disabled={rel.rel < R.annexThreshold || !canPay(me.res, annex)}
                          onClick={() => dispatch({ type: 'annex', target: f.id })}
                        >
                          🤝 เสนอรวมแผ่นดิน{' '}
                          <small>
                            {costText(annex)} จ่ายเมื่ออีกฝ่ายยอมรับ, ต้องมีสัมพันธ์ {R.annexThreshold}
                          </small>
                        </button>
                      )}
                      <button
                        className="btn danger"
                        onClick={() =>
                          pushModal({
                            kind: 'confirm',
                            title: `ประกาศสงครามกับ${f.name}?`,
                            body: 'ความสัมพันธ์จะลดเหลือไม่เกิน −60 เสถียรภาพ −5 และแคว้นอื่นจะไม่พอใจ สงครามยังลดเสถียรภาพ 2 ทุกฤดูจนกว่าจะสงบศึก อีกฝ่ายต้องยอมรับข้อเสนอเองจึงจะสงบศึกได้',
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
        </>
      )}
      <p className="muted small">
        ค่าใช้จ่ายการทูตฤดูนี้ ×{diplo}
        {diplo < 1 ? ' ฤดูร้อนเหมาะกับการเจรจา' : ''}
      </p>
      {alive.map((f) => {
        const rel = relation(state, f.id, ME);
        const tribute = cost(costs.tribute);
        const festival = cost(costs.festival);
        const annex = cost(costs.annex);
        const peace = cost(costs.peace);
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
                <em style={{ left: `${(R.annexThreshold + 100) / 2}%` }} />
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
                      {costText(tribute)}, สัมพันธ์ +{R.tributeGain}
                    </small>
                  </button>
                  <button
                    className="btn"
                    disabled={!canPay(me.res, festival)}
                    onClick={() => dispatch({ type: 'festival', target: f.id })}
                  >
                    🪷 จัดงานบุญร่วมกัน{' '}
                    <small>
                      {costText(festival)}, สัมพันธ์ +{R.festivalGain}
                    </small>
                  </button>
                  <button
                    className="btn good"
                    disabled={rel.rel < R.annexThreshold || !canPay(me.res, annex)}
                    onClick={() => dispatch({ type: 'annex', target: f.id })}
                  >
                    🤝 ผนวกโดยสันติ{' '}
                    <small>
                      {costText(annex)}, ต้องมีสัมพันธ์ {R.annexThreshold}
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
      {deadHumans.map((f) => (
        <div className="card dim" key={f.id}>
          <div className="ch">
            <span className="sw" style={{ background: `var(--own-${f.colorToken})` }} />
            <h3>{f.name}</h3>
          </div>
          <p className="muted small">ล่มสลายไปแล้ว</p>
        </div>
      ))}
    </>
  );
}
