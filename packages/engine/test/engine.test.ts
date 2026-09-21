import { describe, expect, it } from 'vitest';
import {
  applyAction,
  armiesOf,
  capitalOf,
  cityYield,
  computeIncome,
  createGame,
  evaluateEnding,
  reachableTiles,
  relation,
  viewFor,
} from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, botSeason, rng } from './helpers.js';

const endSeasons = (s: GameState, n: number): GameState => {
  for (let i = 0; i < n; i++) {
    for (const d of s.pending.filter((p) => p.faction === 'p1'))
      s = act(s, 'p1', {
        type: 'answerDecision',
        decisionId: d.id,
        choice: d.kind === 'offer' ? 'decline' : 'yield',
      });
    s = act(s, 'p1', { type: 'endTurn' });
  }
  return s;
};

describe('createGame', () => {
  it('sets up one human and three AI seats by default', () => {
    const s = createGame({ seed: 1 });
    expect(s.order).toEqual(['p1', 'north', 'east', 'south']);
    expect(s.factions.p1!.kind).toBe('human');
    expect(capitalOf(s, 'p1')!.name).toBe('กรุงนที');
    expect(capitalOf(s, 'p1')!.garrison).toBe(30);
    expect(relation(s, 'p1', 'east').rel).toBe(-10);
    expect(armiesOf(s, 'p1')[0]!.mp).toBe(1);
  });

  it('seats extra humans in AI slots', () => {
    const s = createGame({ seed: 1, humans: [{ id: 'u1' }, { id: 'u2', name: 'ล้านนา' }] });
    expect(s.factions.u2!.kind).toBe('human');
    expect(s.factions.u2!.seat).toBe('north');
    expect(s.factions.u2!.name).toBe('ล้านนา');
    expect(relation(s, 'u1', 'u2')).toEqual({ rel: 0, war: false });
  });

  it('rejects duplicate ids', () => {
    expect(() => createGame({ humans: [{ id: 'x' }, { id: 'x' }] })).toThrow();
  });
});

describe('determinism', () => {
  it('same seed and same commands produce identical states', () => {
    const run = () => {
      let s = createGame({ seed: 42 });
      const r = rng(7);
      for (let i = 0; i < 20 && !s.ended; i++) s = botSeason(s, 'p1', r, 'war');
      return s;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('applyAction never mutates its input', () => {
    const s = createGame({ seed: 3 });
    const before = JSON.stringify(s);
    applyAction(s, 'p1', { type: 'endTurn' });
    applyAction(s, 'p1', { type: 'build', cityId: capitalOf(s, 'p1')!.id, building: 'granary' });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('economy', () => {
  it('capital yield matches the prototype', () => {
    const s = createGame({ seed: 1 });
    expect(cityYield(capitalOf(s, 'p1')!)).toEqual({ rice: 20, man: 8, wealth: 8, faith: 2, know: 1 });
  });

  it('seasons scale income; cool season is the harvest', () => {
    let s = createGame({ seed: 1 });
    const rain = computeIncome(s, s.factions.p1!);
    s = act(s, 'p1', { type: 'endTurn' });
    const cool = computeIncome(s, s.factions.p1!);
    expect(cool.rice).toBeGreaterThan(rain.rice * 1.8);
    expect(rain.upkeep).toBe(3);
  });

  it('hot season discounts buildings', () => {
    let s = createGame({ seed: 1 });
    s = endSeasons(s, 2); // → hot, with a pending offer
    s = act(s, 'p1', { type: 'answerDecision', decisionId: s.pending[0]!.id, choice: 'decline' });
    const cap = capitalOf(s, 'p1')!;
    const wealth = s.factions.p1!.res.wealth;
    s = act(s, 'p1', { type: 'build', cityId: cap.id, building: 'academy' });
    expect(wealth - s.factions.p1!.res.wealth).toBe(30); // 40 × 0.75
  });
});

describe('validation', () => {
  it('rejects illegal commands with typed errors', () => {
    const s = createGame({ seed: 1 });
    const army = armiesOf(s, 'p1')[0]!;
    const cap = capitalOf(s, 'p1')!;
    const expectErr = (res: ReturnType<typeof applyAction>, code: string) => {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(code);
    };
    expectErr(applyAction(s, 'north', { type: 'endTurn' }), 'NOT_YOUR_FACTION');
    expectErr(applyAction(s, 'p1', { type: 'move', armyId: army.id, c: 5, r: 3 }), 'UNREACHABLE');
    expectErr(applyAction(s, 'p1', { type: 'build', cityId: cap.id, building: 'port' }), 'NOT_COASTAL');
    expectErr(applyAction(s, 'p1', { type: 'annex', target: 'north' }), 'RELATION_TOO_LOW');
    expectErr(applyAction(s, 'p1', { type: 'offerPeace', target: 'north' }), 'NOT_AT_WAR');
    expectErr(applyAction(s, 'p1', { type: 'tribute', target: 'p1' }), 'INVALID_TARGET');
    expectErr(applyAction(s, 'p1', { type: 'found', armyId: army.id }), 'INVALID_LOCATION');
    expectErr(applyAction(s, 'p1', { type: 'nope' } as never), 'UNKNOWN_ACTION');
  });

  it('rain season lets an army step into costly terrain only with full movement', () => {
    let s = createGame({ seed: 1 });
    const army = armiesOf(s, 'p1')[0]!;
    const reach = reachableTiles(s, army);
    expect(reach.size).toBe(6);
    s = act(s, 'p1', { type: 'move', armyId: army.id, c: 6, r: 7 });
    expect(reachableTiles(s, armiesOf(s, 'p1')[0]!).size).toBe(0);
  });

  it('cannot attack without war', () => {
    let s = createGame({ seed: 1 });
    const army = s.armies.find((a) => a.owner === 'p1')!;
    // teleport next to the east army for the test
    army.c = 8;
    army.r = 4;
    const res = applyAction(s, 'p1', { type: 'attack', armyId: army.id, c: 9, r: 4 });
    expect(res.ok).toBe(false);
    s = act(s, 'p1', { type: 'declareWar', target: 'east' });
    expect(relation(s, 'p1', 'east').war).toBe(true);
    const fought = applyAction(s, 'p1', { type: 'attack', armyId: army.id, c: 9, r: 4 });
    expect(fought.ok).toBe(true);
    if (fought.ok) expect(fought.events.some((e) => e.kind === 'battle' && e.battle)).toBe(true);
  });
});

describe('great powers', () => {
  it('queues an offer in the hot season and blocks other commands until answered', () => {
    let s = createGame({ seed: 5 });
    s = act(s, 'p1', { type: 'endTurn' });
    s = act(s, 'p1', { type: 'endTurn' });
    expect(s.pending).toHaveLength(1);
    const d = s.pending[0]!;
    expect(d.power).toBe('lion');
    const blocked = applyAction(s, 'p1', { type: 'endTurn' });
    expect(blocked.ok).toBe(false);
    s = act(s, 'p1', { type: 'answerDecision', decisionId: d.id, choice: 'accept' });
    expect(s.pending).toHaveLength(0);
    expect(s.factions.p1!.meter).toBeLessThan(0);
  });

  it('declining until patience runs out triggers an ultimatum', () => {
    let s = createGame({ seed: 9 });
    s.factions.p1!.powers.lion.patience = 1;
    s = act(s, 'p1', { type: 'endTurn' });
    s = act(s, 'p1', { type: 'endTurn' });
    s = act(s, 'p1', { type: 'answerDecision', decisionId: s.pending[0]!.id, choice: 'decline' });
    expect(s.pending[0]?.kind).toBe('ultimatum');
    const bad = applyAction(s, 'p1', {
      type: 'answerDecision',
      decisionId: s.pending[0]!.id,
      choice: 'accept',
    });
    expect(bad.ok).toBe(false);
    s = act(s, 'p1', { type: 'answerDecision', decisionId: s.pending[0]!.id, choice: 'yield' });
    expect(s.factions.p1!.sovereignty).toBeLessThanOrEqual(85);
  });
});

describe('diplomacy', () => {
  it('annexes an AI peacefully at relation 80', () => {
    let s = createGame({ seed: 1 });
    relation(s, 'p1', 'south').rel = 80;
    s.factions.p1!.res.faith = 40;
    s = act(s, 'p1', { type: 'annex', target: 'south' });
    expect(s.factions.south!.alive).toBe(false);
    expect(s.cities.filter((c) => c.owner === 'p1')).toHaveLength(2);
    expect(armiesOf(s, 'p1')).toHaveLength(2);
    expect(s.factions.p1!.stats.annexed).toBe(1);
  });

  it('lets two humans negotiate peace through a proposal, not a coin flip', () => {
    let s = createGame({ seed: 1, humans: [{ id: 'a' }, { id: 'b' }] });
    s = act(s, 'a', { type: 'declareWar', target: 'b' });
    expect(relation(s, 'a', 'b').war).toBe(true);

    // offerPeace still only works against AI — humans must use proposePeace/answerProposal.
    const bounced = applyAction(s, 'a', { type: 'offerPeace', target: 'b' });
    expect(bounced.ok).toBe(false);
    if (!bounced.ok) expect(bounced.error).toBe('INVALID_TARGET');

    s = act(s, 'a', { type: 'proposePeace', target: 'b' });
    const proposal = s.proposals.find((p) => p.from === 'a' && p.to === 'b');
    expect(proposal).toBeDefined();
    expect(proposal!.kind).toBe('peace');
    // still at war until b answers — a's own turn isn't blocked by the proposal it sent.
    expect(relation(s, 'a', 'b').war).toBe(true);

    // a proposal is only visible to its two parties.
    expect(viewFor(s, 'a').proposals).toHaveLength(1);
    expect(viewFor(s, 'b').proposals).toHaveLength(1);

    s = act(s, 'b', { type: 'answerProposal', proposalId: proposal!.id, accept: true });
    expect(relation(s, 'a', 'b').war).toBe(false);
    expect(s.proposals).toHaveLength(0);
  });

  it('clears the proposal without making peace when the target declines', () => {
    let s = createGame({ seed: 1, humans: [{ id: 'a' }, { id: 'b' }] });
    s = act(s, 'a', { type: 'declareWar', target: 'b' });
    s = act(s, 'a', { type: 'proposePeace', target: 'b' });
    const proposal = s.proposals[0]!;
    s = act(s, 'b', { type: 'answerProposal', proposalId: proposal.id, accept: false });
    expect(relation(s, 'a', 'b').war).toBe(true);
    expect(s.proposals).toHaveLength(0);
  });

  it('rejects a peace proposal outside war, from a non-recipient, or against AI', () => {
    const s = createGame({ seed: 1, humans: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const notAtWar = applyAction(s, 'a', { type: 'proposePeace', target: 'b' });
    expect(notAtWar.ok).toBe(false);
    if (!notAtWar.ok) expect(notAtWar.error).toBe('NOT_AT_WAR');

    const vsAi = applyAction(s, 'a', { type: 'proposePeace', target: 'south' });
    expect(vsAi.ok).toBe(false);
    if (!vsAi.ok) expect(vsAi.error).toBe('INVALID_TARGET');

    let s2 = act(s, 'a', { type: 'declareWar', target: 'b' });
    s2 = act(s2, 'a', { type: 'proposePeace', target: 'b' });
    // c is a bystander human, not the proposal's recipient — cannot answer it.
    const wrongAnswerer = applyAction(s2, 'c', {
      type: 'answerProposal',
      proposalId: s2.proposals[0]!.id,
      accept: true,
    });
    expect(wrongAnswerer.ok).toBe(false);
    if (!wrongAnswerer.ok) expect(wrongAnswerer.error).toBe('NOT_FOUND');
  });

  it('clears the other side’s in-flight proposal too when mutual peace offers cross', () => {
    let s = createGame({ seed: 1, humans: [{ id: 'a' }, { id: 'b' }] });
    s = act(s, 'a', { type: 'declareWar', target: 'b' });
    s = act(s, 'a', { type: 'proposePeace', target: 'b' });
    s = act(s, 'b', { type: 'proposePeace', target: 'a' });
    expect(s.proposals).toHaveLength(2);
    const aToB = s.proposals.find((p) => p.from === 'a' && p.to === 'b')!;
    s = act(s, 'b', { type: 'answerProposal', proposalId: aToB.id, accept: true });
    expect(relation(s, 'a', 'b').war).toBe(false);
    // b's own now-moot proposal to a is cleaned up too, not left dangling.
    expect(s.proposals).toHaveLength(0);
  });
});

describe('endings and views', () => {
  it('evaluates endings in priority order', () => {
    const s = createGame({ seed: 1 });
    const f = s.factions.p1!;
    expect(evaluateEnding(s, f)).toBe('survive');
    f.knowTotal = 200;
    f.faithTotal = 200;
    expect(evaluateEnding(s, f)).toBe('wisdom');
    f.sovereignty = 30;
    expect(evaluateEnding(s, f)).toBe('shadow');
    f.alive = false;
    expect(evaluateEnding(s, f)).toBe('ashes');
  });

  it('game ends after the last season with an ending for the human', () => {
    let s = createGame({ seed: 11, maxTurn: 6 });
    s = endSeasons(s, 6);
    expect(s.ended).toBe(true);
    expect(s.factions.p1!.ending).not.toBeNull();
    expect(applyAction(s, 'p1', { type: 'endTurn' }).ok).toBe(false);
  });

  it('viewFor hides other humans’ treasury and private events', () => {
    const s = createGame({ seed: 1, humans: [{ id: 'a' }, { id: 'b' }] });
    const v = viewFor(s, 'a');
    expect(v.factions.b!.res.wealth).toBe(0);
    expect(v.factions.a!.res.wealth).toBe(80);
    expect(v.rng).toBe(0);
  });
});
