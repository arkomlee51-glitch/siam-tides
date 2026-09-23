import { describe, expect, it } from 'vitest';
import {
  applyAction,
  citiesOf,
  createGame,
  earlyRattanakosinChapter,
  finishGame,
  relation,
  scaleCost,
  seasonOf,
  viewFor,
} from '../src/index.js';
import type { Ctx, GameState } from '../src/index.js';
import { act } from './helpers.js';

const R = earlyRattanakosinChapter.rules;
const C = earlyRattanakosinChapter.costs;

/** two humans, rich enough to afford anything, at peace */
function twoHumans(): GameState {
  const s = createGame({
    humans: [
      { id: 'p1', name: 'หนึ่ง' },
      { id: 'p2', name: 'สอง' },
    ],
    seed: 7,
  });
  for (const f of [s.factions.p1!, s.factions.p2!])
    f.res = { rice: 999, man: 999, wealth: 999, faith: 999, know: 0 };
  return s;
}

describe('การทูตระหว่างผู้เล่นมนุษย์ (ADR-0008)', () => {
  it('บรรณาการให้มนุษย์: ผู้ส่งจ่าย ผู้รับได้ของจริงเท่าที่จ่าย ความสัมพันธ์ขึ้น ทั้งคู่ได้รับแจ้ง', () => {
    const s = twoHumans();
    const cost = scaleCost(C.tribute!, seasonOf(s.turn).diplo);
    const before = relation(s, 'p1', 'p2').rel;
    const r = applyAction(s, 'p1', { type: 'tribute', target: 'p2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of Object.keys(cost) as (keyof typeof cost)[]) {
      expect(r.state.factions.p1!.res[k]).toBe(999 - cost[k]!);
      expect(r.state.factions.p2!.res[k]).toBe(999 + cost[k]!);
    }
    expect(relation(r.state, 'p1', 'p2').rel).toBe(before + R.tributeGain);
    expect(r.events.some((e) => e.to?.includes('p2') && e.text.includes('ส่งบรรณาการให้คุณ'))).toBe(true);
  });

  it('งานบุญร่วมกับมนุษย์: ความสัมพันธ์ขึ้น แต่ไม่มีของขวัญ', () => {
    const s = twoHumans();
    const r = applyAction(s, 'p1', { type: 'festival', target: 'p2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.factions.p2!.res).toEqual(s.factions.p2!.res);
    expect(relation(r.state, 'p1', 'p2').rel).toBe(relation(s, 'p1', 'p2').rel + R.festivalGain);
  });

  it('ทำไม่ได้ระหว่างสงคราม และส่งให้ตัวเองไม่ได้', () => {
    const s = twoHumans();
    relation(s, 'p1', 'p2').war = true;
    expect(applyAction(s, 'p1', { type: 'tribute', target: 'p2' })).toMatchObject({
      ok: false,
      error: 'AT_WAR',
    });
    expect(applyAction(s, 'p1', { type: 'tribute', target: 'p1' })).toMatchObject({
      ok: false,
      error: 'INVALID_TARGET',
    });
  });

  it('ผนวกมนุษย์ = ส่งข้อเสนอรวมแผ่นดิน ไม่จ่ายเงินตอนเสนอ และต้องมีความสัมพันธ์ถึงเกณฑ์', () => {
    const s = twoHumans();
    relation(s, 'p1', 'p2').rel = R.annexThreshold - 1;
    expect(applyAction(s, 'p1', { type: 'annex', target: 'p2' })).toMatchObject({
      ok: false,
      error: 'RELATION_TOO_LOW',
    });

    relation(s, 'p1', 'p2').rel = R.annexThreshold;
    const next = act(s, 'p1', { type: 'annex', target: 'p2' });
    expect(next.factions.p1!.res).toEqual(s.factions.p1!.res);
    expect(next.factions.p2!.alive).toBe(true);
    expect(viewFor(next, 'p2').proposals).toEqual([
      expect.objectContaining({ kind: 'union', from: 'p1', to: 'p2' }),
    ]);
  });

  it('ยอมรับ: ผู้เสนอจ่ายค่าผนวก ได้เมืองและทัพทั้งหมด ผู้ยอมรับออกจากเกมด้วยตอนจบ "รวมแผ่นดิน"', () => {
    const s = twoHumans();
    relation(s, 'p1', 'p2').rel = R.annexThreshold;
    const proposed = act(s, 'p1', { type: 'annex', target: 'p2' });
    const p2Cities = citiesOf(proposed, 'p2').length;
    const p1Cities = citiesOf(proposed, 'p1').length;
    const cost = scaleCost(C.annex!, seasonOf(proposed.turn).diplo);
    const proposalId = proposed.proposals[0]!.id;

    const done = act(proposed, 'p2', { type: 'answerProposal', proposalId, accept: true });
    expect(done.factions.p2!.alive).toBe(false);
    expect(done.factions.p2!.ending).toBe('union');
    expect(citiesOf(done, 'p1').length).toBe(p1Cities + p2Cities);
    expect(done.armies.some((a) => a.owner === 'p2')).toBe(false);
    expect(done.factions.p1!.stats.annexed).toBe(1);
    for (const k of Object.keys(cost) as (keyof typeof cost)[])
      expect(done.factions.p1!.res[k]).toBe(999 - cost[k]!);
    expect(done.proposals).toEqual([]);
    // ผู้ที่ออกจากเกมสั่งอะไรต่อไม่ได้
    expect(applyAction(done, 'p2', { type: 'endTurn' })).toMatchObject({
      ok: false,
      error: 'FACTION_ELIMINATED',
    });
  });

  it('ตอนจบ "รวมแผ่นดิน" คงอยู่ตอนจบเกม ไม่ถูกประเมินทับเป็น "เถ้าถ่าน"', () => {
    const s = twoHumans();
    relation(s, 'p1', 'p2').rel = R.annexThreshold;
    const proposed = act(s, 'p1', { type: 'annex', target: 'p2' });
    const done = act(proposed, 'p2', {
      type: 'answerProposal',
      proposalId: proposed.proposals[0]!.id,
      accept: true,
    });
    const ended = structuredClone(done);
    const ctx: Ctx = { s: ended, ev: [] };
    finishGame(ctx);
    expect(ended.factions.p2!.ending).toBe('union');
  });

  it('ถ้าเงื่อนไขเปลี่ยนก่อนตอบ (ผู้เสนอทรัพย์ไม่พอ) ข้อเสนอเป็นโมฆะ ไม่มีอะไรย้ายมือ', () => {
    const s = twoHumans();
    relation(s, 'p1', 'p2').rel = R.annexThreshold;
    const proposed = act(s, 'p1', { type: 'annex', target: 'p2' });
    proposed.factions.p1!.res = { rice: 0, man: 0, wealth: 0, faith: 0, know: 0 };
    const r = applyAction(proposed, 'p2', {
      type: 'answerProposal',
      proposalId: proposed.proposals[0]!.id,
      accept: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.factions.p2!.alive).toBe(true);
    expect(r.state.proposals).toEqual([]);
    expect(r.events.some((e) => e.text.includes('เป็นโมฆะ'))).toBe(true);
  });

  it('ไม่ค้าง: ถ้าผู้เสนอจบฤดูไปแล้ว การยอมรับของผู้เล่นคนสุดท้ายจะจบฤดูให้เอง', () => {
    const s = twoHumans();
    relation(s, 'p1', 'p2').rel = R.annexThreshold;
    let st = act(s, 'p1', { type: 'annex', target: 'p2' });
    st = act(st, 'p1', { type: 'endTurn' });
    expect(st.turn).toBe(1); // p2 ยังไม่จบฤดู
    st = act(st, 'p2', { type: 'answerProposal', proposalId: st.proposals[0]!.id, accept: true });
    expect(st.turn).toBe(2);
    expect(st.ready).toEqual([]);
  });

  it('ปฏิเสธ: ผู้เสนอได้รับแจ้ง ไม่มีอะไรเปลี่ยน', () => {
    const s = twoHumans();
    relation(s, 'p1', 'p2').rel = R.annexThreshold;
    const proposed = act(s, 'p1', { type: 'annex', target: 'p2' });
    const r = applyAction(proposed, 'p2', {
      type: 'answerProposal',
      proposalId: proposed.proposals[0]!.id,
      accept: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.factions.p2!.alive).toBe(true);
    expect(r.events.some((e) => e.to?.includes('p1') && e.text.includes('ปฏิเสธข้อเสนอรวมแผ่นดิน'))).toBe(
      true,
    );
  });

  it('ประกาศสงครามแล้ว ข้อเสนอรวมแผ่นดินที่ค้างระหว่างสองฝ่ายหายไปด้วย', () => {
    const s = twoHumans();
    relation(s, 'p1', 'p2').rel = R.annexThreshold;
    const proposed = act(s, 'p1', { type: 'annex', target: 'p2' });
    const war = act(proposed, 'p2', { type: 'declareWar', target: 'p1' });
    expect(war.proposals).toEqual([]);
  });
});
