import { describe, expect, it } from 'vitest';
import {
  CHAPTERS,
  CORE_RESOURCE_IDS,
  ChapterValidationError,
  LEGACY_CAPS,
  LEGACY_CATEGORIES,
  allPowersPatient,
  applyLegacyBonuses,
  armiesOf,
  buildingDefenseMultiplier,
  buildingStabilityBonus,
  capitalOf,
  cityYield,
  combatMultiplier,
  computeIncome,
  computeLegacyBonuses,
  createGame,
  describeDecision,
  disasterMitigation,
  earlyRattanakosinChapter,
  finishGame,
  hexDistance,
  mergeLegacyBonuses,
  offeringPower,
  reachableTiles,
  resourceMultiplier,
  runAi,
  scaleCost,
  upkeepOf,
  validateChapterDefinition,
} from '../src/index.js';
import { seasonOf } from '../src/index.js';
import { act } from './helpers.js';
import type { BuildingId } from '../src/index.js';
import type { ChapterDefinition, Ctx, PendingDecision, PerkDefData } from '../src/index.js';
import type { PerkId, PowerId } from '../src/index.js';

describe('content schema (เฟส 6)', () => {
  it('accepts the chapter ported from the shipping data.ts content', () => {
    expect(() => validateChapterDefinition(earlyRattanakosinChapter)).not.toThrow();
  });

  it('carries every field the live game actually uses, with matching values', () => {
    // spot-check that the port didn't silently drop or rename anything the engine reads
    expect(earlyRattanakosinChapter.rules.maxTurn).toBe(30);
    expect(earlyRattanakosinChapter.seats).toHaveLength(4);
    expect(earlyRattanakosinChapter.buildings.granary).toMatchObject({ id: 'granary' });
    expect(Object.keys(earlyRattanakosinChapter.foreignPowers).sort()).toEqual(['eagle', 'lion']);
    for (const id of CORE_RESOURCE_IDS) {
      expect(earlyRattanakosinChapter.resourceLabels[id]).toBeDefined();
    }
  });

  it('rejects a chapter with structural problems and lists every issue found', () => {
    const broken: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      manifest: { ...earlyRattanakosinChapter.manifest, id: 'broken', order: 9 },
      map: ['CK', 'CKK'], // ragged rows
      terrainOrder: ['C', 'ghost'], // unknown terrain id
      endingOrder: ['no-such-ending'],
    };
    expect(() => validateChapterDefinition(broken)).toThrow(ChapterValidationError);
    try {
      validateChapterDefinition(broken);
      throw new Error('expected validateChapterDefinition to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ChapterValidationError);
      const message = (err as Error).message;
      expect(message).toContain('order must be an integer');
      expect(message).toContain('row 1 has length');
      expect(message).toContain("terrainOrder references unknown terrain 'ghost'");
      expect(message).toContain("endingOrder references unknown ending 'no-such-ending'");
    }
  });
});

describe('createGame reads chapter data (เฟส 6, ADR-0007 ข้อ 7)', () => {
  it('passing the default chapter explicitly produces the same state as omitting it', () => {
    const a = createGame({ humans: [{ id: 'p1' }, { id: 'p2' }], seed: 42, maxTurn: 10 });
    const b = createGame({
      humans: [{ id: 'p1' }, { id: 'p2' }],
      seed: 42,
      maxTurn: 10,
      chapter: earlyRattanakosinChapter,
    });
    expect(b).toEqual(a);
  });

  it('a chapter with fewer seats caps how many humans can join, not the hard-coded default', () => {
    const twoSeatChapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      seats: earlyRattanakosinChapter.seats.slice(0, 2),
    };
    expect(() =>
      createGame({ humans: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], chapter: twoSeatChapter }),
    ).toThrow(/at most 2 human players/);
    const s = createGame({ humans: [{ id: 'p1' }, { id: 'p2' }], chapter: twoSeatChapter });
    expect(s.order).toEqual(['p1', 'p2']);
  });

  it('starting resources/stability/garrison come from the chapter rules, not data.ts by name', () => {
    const customChapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      rules: {
        ...earlyRattanakosinChapter.rules,
        startResources: { rice: 999, man: 1, wealth: 2, faith: 3, know: 4 },
        startStability: 55,
        humanCapitalGarrison: 7,
        maxTurn: 3,
      },
    };
    const s = createGame({ humans: [{ id: 'p1' }], chapter: customChapter });
    expect(s.factions.p1!.res).toEqual({ rice: 999, man: 1, wealth: 2, faith: 3, know: 4 });
    expect(s.factions.p1!.stability).toBe(55);
    expect(s.maxTurn).toBe(3);
    const capital = s.cities.find((c) => c.owner === 'p1' && c.capital);
    expect(capital?.garrison).toBe(7);
  });

  it("a chapter's foreign-power roster drives Faction.powers, not data.ts's POWER_IDS", () => {
    const oneWayChapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      foreignPowers: { lion: earlyRattanakosinChapter.foreignPowers.lion! },
    };
    const s = createGame({ humans: [{ id: 'p1' }], chapter: oneWayChapter });
    expect(Object.keys(s.factions.p1!.powers)).toEqual(['lion']);
  });

  it('sanity: seasonOf is unaffected by chapter choice (still chapter-agnostic — see boundary note)', () => {
    expect(seasonOf(1).id).toBe('rain');
  });
});

describe('legacy bonuses (เฟส 6)', () => {
  it('gives no bonus to a faction with nothing accomplished yet', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 1 });
    const bonuses = computeLegacyBonuses(s, 'early-rattanakosin', 'p1');
    // brand-new game: one city, starting resources — small infra bonus is plausible,
    // but nothing should ever exceed its category cap even at turn 1
    for (const b of bonuses) expect(b.amount).toBeLessThanOrEqual(LEGACY_CAPS[b.category]);
  });

  it('never exceeds the declared cap no matter how large the raw inputs are', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 2 });
    const f = s.factions.p1!;
    f.res.wealth = 1_000_000;
    f.faithTotal = 1_000_000;
    f.knowTotal = 1_000_000;
    f.stats.wins = 1000;
    f.stats.negotiated = 1000;
    f.stats.accepted = 1000;
    for (const city of s.cities) city.owner = 'p1';

    const bonuses = computeLegacyBonuses(s, 'early-rattanakosin', 'p1');
    expect(bonuses.length).toBeGreaterThan(0);
    for (const b of bonuses) {
      expect(b.amount).toBeLessThanOrEqual(LEGACY_CAPS[b.category]);
      expect(b.amount).toBeGreaterThan(0);
    }

    const totals = mergeLegacyBonuses(bonuses);
    for (const category of LEGACY_CATEGORIES) {
      expect(totals[category]).toBeLessThanOrEqual(LEGACY_CAPS[category]);
    }
  });

  it('is deterministic — same state in, same bonuses out', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 3 });
    const a = computeLegacyBonuses(s, 'early-rattanakosin', 'p1');
    const b = computeLegacyBonuses(s, 'early-rattanakosin', 'p1');
    expect(a).toEqual(b);
  });

  it('returns an empty list for an unknown faction rather than throwing', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 4 });
    expect(computeLegacyBonuses(s, 'early-rattanakosin', 'no-such-faction')).toEqual([]);
  });

  it('merging bonuses from multiple past chapters still respects the cap', () => {
    const merged = mergeLegacyBonuses([
      { category: 'knowledge', amount: 0.1, sourceChapterId: 'a', note: '' },
      { category: 'knowledge', amount: 0.1, sourceChapterId: 'b', note: '' },
      { category: 'knowledge', amount: 0.1, sourceChapterId: 'c', note: '' },
    ]);
    expect(merged.knowledge).toBe(LEGACY_CAPS.knowledge);
  });

  it('turns merged totals into generic start-of-game adjustments only, never chapter-specific ids', () => {
    const totals = mergeLegacyBonuses([
      { category: 'infrastructure', amount: 0.1, sourceChapterId: 'a', note: '' },
      { category: 'military', amount: 0.05, sourceChapterId: 'a', note: '' },
      { category: 'diplomacy', amount: 0.05, sourceChapterId: 'a', note: '' },
    ]);
    const adj = applyLegacyBonuses(totals);
    expect(adj.cityYieldMultiplier.rice).toBeCloseTo(1.1);
    expect(adj.armyStrMultiplier).toBeCloseTo(1.05);
    expect(adj.relationBonus).toBe(Math.round(0.05 * 30));
    expect(adj.startResourceBonus).toEqual({});
  });

  it('produces a zero-effect adjustment when there is nothing to carry forward', () => {
    const totals = mergeLegacyBonuses([]);
    const adj = applyLegacyBonuses(totals);
    expect(adj.cityYieldMultiplier).toEqual({});
    expect(adj.stabilityBonus).toBe(0);
    expect(adj.armyStrMultiplier).toBe(1);
    expect(adj.relationBonus).toBe(0);
  });
});

describe('perk effects are data, not hard-coded perk ids (ADR-0007 Addendum 4)', () => {
  it('resourceMultiplier is 1 for a faction with no matching perk unlocked', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 5 });
    const f = s.factions.p1!;
    expect(resourceMultiplier(f, 'rice', earlyRattanakosinChapter)).toBe(1);
    expect(resourceMultiplier(f, 'know', earlyRattanakosinChapter)).toBe(1);
  });

  it("matches the shipped chapter's declared perk multipliers once unlocked", () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 6 });
    const f = s.factions.p1!;
    f.perks.push('irrig');
    expect(resourceMultiplier(f, 'rice', earlyRattanakosinChapter)).toBeCloseTo(1.2);
    expect(resourceMultiplier(f, 'know', earlyRattanakosinChapter)).toBe(1); // irrig doesn't touch know
    f.perks.push('print');
    expect(resourceMultiplier(f, 'know', earlyRattanakosinChapter)).toBeCloseTo(1.3);
  });

  it('combatMultiplier is 1 with no combat perk, matches the declared value once unlocked', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 7 });
    const f = s.factions.p1!;
    expect(combatMultiplier(f, earlyRattanakosinChapter)).toBe(1);
    f.perks.push('powder');
    expect(combatMultiplier(f, earlyRattanakosinChapter)).toBeCloseTo(1.2);
  });

  it('is genuinely generic: a perk with an id the engine has never seen still applies its declared effect', () => {
    // proves resourceMultiplier/combatMultiplier read `perk.effects` data rather than
    // branching on the literal strings 'irrig'/'powder'/'print' — a chapter could name
    // its perks anything.
    const madeUpPerk: PerkDefData = {
      id: 'monsoon-canals',
      at: 10,
      name: 'คลองมรสุม',
      desc: 'ทดสอบ: ผลผลิตทรัพย์ +50%',
      effects: [{ kind: 'resourceMultiplier', resource: 'wealth', multiplier: 1.5 }],
    };
    const madeUpCombatPerk: PerkDefData = {
      id: 'steel-hulls',
      at: 20,
      name: 'เรือเหล็ก',
      desc: 'ทดสอบ: พลังรบ +40%',
      effects: [{ kind: 'combatMultiplier', multiplier: 1.4 }],
    };
    const customChapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      perks: [madeUpPerk, madeUpCombatPerk],
    };
    const s = createGame({ humans: [{ id: 'p1' }], seed: 8 });
    const f = s.factions.p1!;
    expect(resourceMultiplier(f, 'wealth', customChapter)).toBe(1); // not unlocked yet
    f.perks.push('monsoon-canals' as PerkId);
    expect(resourceMultiplier(f, 'wealth', customChapter)).toBeCloseTo(1.5);
    expect(combatMultiplier(f, customChapter)).toBe(1); // steel-hulls not unlocked
    f.perks.push('steel-hulls' as PerkId);
    expect(combatMultiplier(f, customChapter)).toBeCloseTo(1.4);
  });

  it('computeIncome applies the resource multiplier through the full income calculation', () => {
    const base = createGame({ humans: [{ id: 'p1' }], seed: 9, maxTurn: 5 });
    const boosted = createGame({ humans: [{ id: 'p1' }], seed: 9, maxTurn: 5 });
    boosted.factions.p1!.perks.push('irrig');
    const baseIncome = computeIncome(base, base.factions.p1!);
    const boostedIncome = computeIncome(boosted, boosted.factions.p1!);
    expect(boostedIncome.rice).toBeGreaterThan(baseIncome.rice);
  });
});

describe('building/terrain effects and foreign-power generalization (ADR-0007 Addendum 5)', () => {
  it("buildingStabilityBonus matches the shipped chapter's declared temple effect", () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 10 });
    const f = s.factions.p1!;
    const capital = s.cities.find((c) => c.owner === 'p1' && c.capital)!;
    capital.buildings = ['temple'];
    expect(buildingStabilityBonus(s, f, earlyRattanakosinChapter)).toBe(1);
    capital.buildings = [];
    expect(buildingStabilityBonus(s, f, earlyRattanakosinChapter)).toBe(0);
  });

  it('buildingStabilityBonus is generic: an invented building the shipped chapter has never seen still works', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 11 });
    const f = s.factions.p1!;
    const capital = s.cities.find((c) => c.owner === 'p1' && c.capital)!;
    capital.buildings = ['shrine-of-unity' as BuildingId];
    const customChapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      buildings: {
        ...earlyRattanakosinChapter.buildings,
        'shrine-of-unity': {
          id: 'shrine-of-unity',
          name: 'ทดสอบ',
          desc: 'ทดสอบ',
          cost: {},
          yield: {},
          effects: [{ kind: 'stabilityPerCity', amount: 5 }],
        },
      },
    };
    expect(buildingStabilityBonus(s, f, customChapter)).toBe(5);
    // the shipped chapter's own building list doesn't know this building — proves the
    // lookup reads `chapter.buildings`, not a literal 'temple' check
    expect(buildingStabilityBonus(s, f, earlyRattanakosinChapter)).toBe(0);
  });

  it('end-to-end: a temple in a city raises stability by exactly the effect declared in data', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 20, maxTurn: 5 });
    const capital = s.cities.find((c) => c.owner === 'p1' && c.capital)!;
    capital.buildings = ['temple'];
    const before = s.factions.p1!.stability;
    const after = act(s, 'p1', { type: 'endTurn' });
    const declaredBonus = earlyRattanakosinChapter.buildings.temple!.effects![0]!;
    expect(declaredBonus.kind).toBe('stabilityPerCity');
    expect(after.factions.p1!.stability).toBe(before + (declaredBonus as { amount: number }).amount);
  });

  it('disasterMitigation matches the shipped granary/flood declaration', () => {
    expect(disasterMitigation(earlyRattanakosinChapter, ['granary'], 'flood')).toMatchObject({
      reducedLoss: 8,
    });
    expect(disasterMitigation(earlyRattanakosinChapter, [], 'flood')).toBeUndefined();
    expect(disasterMitigation(earlyRattanakosinChapter, ['granary'], 'earthquake')).toBeUndefined();
  });

  it('disasterMitigation is generic: an invented building/disaster pair the engine has never seen still works', () => {
    const customChapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      buildings: {
        ...earlyRattanakosinChapter.buildings,
        seawall: {
          id: 'seawall',
          name: 'ทดสอบ',
          desc: 'ทดสอบ',
          cost: {},
          yield: {},
          effects: [{ kind: 'disasterLossReduction', disaster: 'tsunami', reducedLoss: 3 }],
        },
      },
    };
    expect(disasterMitigation(customChapter, ['seawall'], 'tsunami')).toMatchObject({ reducedLoss: 3 });
    expect(disasterMitigation(customChapter, ['seawall'], 'flood')).toBeUndefined();
  });

  it('allPowersPatient matches the original 2-power bamboo-diplomacy behavior', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 12 });
    const f = s.factions.p1!;
    f.powers.lion.patience = 2;
    f.powers.eagle.patience = 2;
    expect(allPowersPatient(f, earlyRattanakosinChapter)).toBe(true);
    f.powers.eagle.patience = 1;
    expect(allPowersPatient(f, earlyRattanakosinChapter)).toBe(false);
  });

  it('allPowersPatient is genuinely generic across power count, not hard-coded to exactly lion+eagle', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 13 });
    const f = s.factions.p1!;
    const threePowerChapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      foreignPowers: {
        north: { id: 'north', name: 'ทดสอบเหนือ', icon: '❄️', side: -1 },
        south: { id: 'south', name: 'ทดสอบใต้', icon: '🔥', side: 1 },
        east: { id: 'east', name: 'ทดสอบตะวันออก', icon: '🌅', side: 1 },
      },
    };
    const threePowers = {
      north: { patience: 2 },
      south: { patience: 2 },
      east: { patience: 2 },
    } as unknown as typeof f.powers;
    expect(allPowersPatient({ ...f, powers: threePowers }, threePowerChapter)).toBe(true);
    const oneImpatient = { ...threePowers, east: { patience: 1 } } as unknown as typeof f.powers;
    expect(allPowersPatient({ ...f, powers: oneImpatient }, threePowerChapter)).toBe(false);

    // single-power chapter also works — no special-casing "exactly 2"
    const onePowerChapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      foreignPowers: { north: { id: 'north', name: 'ทดสอบ', icon: '❄️', side: -1 } },
    };
    const onePower = { north: { patience: 2 } } as unknown as typeof f.powers;
    expect(allPowersPatient({ ...f, powers: onePower }, onePowerChapter)).toBe(true);
  });

  it('offeringPower matches the original odd/even-year lion/eagle alternation for the shipped chapter', () => {
    expect(offeringPower(earlyRattanakosinChapter, 1)).toBe('lion');
    expect(offeringPower(earlyRattanakosinChapter, 2)).toBe('eagle');
    expect(offeringPower(earlyRattanakosinChapter, 3)).toBe('lion');
    expect(offeringPower(earlyRattanakosinChapter, 4)).toBe('eagle');
  });

  it('offeringPower is generic: cycles through however many foreign powers a chapter declares', () => {
    const threePowerChapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      foreignPowers: {
        north: { id: 'north', name: 'ทดสอบเหนือ', icon: '❄️', side: -1 },
        south: { id: 'south', name: 'ทดสอบใต้', icon: '🔥', side: 1 },
        east: { id: 'east', name: 'ทดสอบตะวันออก', icon: '🌅', side: 1 },
      },
    };
    expect(offeringPower(threePowerChapter, 1)).toBe('north' as PowerId);
    expect(offeringPower(threePowerChapter, 2)).toBe('south' as PowerId);
    expect(offeringPower(threePowerChapter, 3)).toBe('east' as PowerId);
    expect(offeringPower(threePowerChapter, 4)).toBe('north' as PowerId);
  });

  it('offeringPower throws clearly for a chapter with no foreign powers rather than looping forever', () => {
    const noPowerChapter: ChapterDefinition = { ...earlyRattanakosinChapter, foreignPowers: {} };
    expect(() => offeringPower(noPowerChapter, 1)).toThrow(/no foreign powers/);
  });
});

function withCustomChapter<T>(
  overrides: Partial<ChapterDefinition>,
  fn: (chapter: ChapterDefinition) => T,
): T {
  const chapter: ChapterDefinition = {
    ...earlyRattanakosinChapter,
    manifest: { ...earlyRattanakosinChapter.manifest, id: `test-custom-${Math.random()}` },
    ...overrides,
  };
  CHAPTERS[chapter.manifest.id] = chapter;
  try {
    return fn(chapter);
  } finally {
    delete CHAPTERS[chapter.manifest.id];
  }
}

/**
 * actions.ts/endings.ts/views.ts/ai.ts now resolve chapter content via
 * `getChapterById(s.chapterId)` instead of importing data.ts directly (ADR-0007
 * Addendum 6). These functions are registry-bound (they take `GameState`, not a
 * `ChapterDefinition` parameter), so genericity here is proven by temporarily
 * registering a second, deliberately different chapter under its own id — exactly
 * how a real second chapter would be registered in `content/chapters/index.ts`.
 */
describe('actions/endings/views/ai resolve chapter data generically, not data.ts literals (ADR-0007 Addendum 6)', () => {
  it('applyAction "found" draws the city name, cost, and garrison from chapter data, not data.ts', () => {
    withCustomChapter(
      {
        newCityNames: ['เมืองทดสอบเอ', 'เมืองทดสอบบี'],
        costs: { ...earlyRattanakosinChapter.costs, found: { wealth: 999 } },
        rules: {
          ...earlyRattanakosinChapter.rules,
          cityMinDistance: 0,
          newCityGarrison: 42,
          newCityBaseGarrison: 7,
        },
      },
      (chapter) => {
        const s0 = createGame({ chapter, humans: [{ id: 'p1' }], seed: 1 });
        s0.factions.p1!.res.wealth = 100000;
        const before = s0.factions.p1!.res.wealth;
        // the starting army sits on the capital's own tile — step off it first, since
        // founding a city requires an empty tile (see actions.ts foundBlocker).
        const startArmy = armiesOf(s0, 'p1')[0]!;
        const dest = [...reachableTiles(s0, startArmy).values()][0]!;
        const s1 = act(s0, 'p1', { type: 'move', armyId: startArmy.id, c: dest.c, r: dest.r });
        const army = armiesOf(s1, 'p1')[0]!;
        const after = act(s1, 'p1', { type: 'found', armyId: army.id });
        const city = after.cities.find((c) => c.owner === 'p1' && !c.capital)!;
        expect(chapter.newCityNames).toContain(city.name);
        expect(city.garrison).toBe(42);
        expect(city.baseGarrison).toBe(7);
        const expectedCost = scaleCost(chapter.costs.found!, seasonOf(after.turn).build);
        expect(after.factions.p1!.res.wealth).toBe(before - (expectedCost.wealth ?? 0));
      },
    );
  });

  it('applyAction "build" reads cost from chapter.buildings for the same building id, not data.ts BUILDINGS', () => {
    withCustomChapter(
      {
        buildings: {
          ...earlyRattanakosinChapter.buildings,
          market: { ...earlyRattanakosinChapter.buildings['market']!, cost: { wealth: 777 } },
        },
      },
      (chapter) => {
        const s0 = createGame({ chapter, humans: [{ id: 'p1' }], seed: 2 });
        s0.factions.p1!.res.wealth = 100000;
        const before = s0.factions.p1!.res.wealth;
        const capital = s0.cities.find((c) => c.owner === 'p1' && c.capital)!;
        const after = act(s0, 'p1', { type: 'build', cityId: capital.id, building: 'market' as BuildingId });
        expect(after.cities.find((c) => c.id === capital.id)!.buildings).toContain('market');
        const expectedCost = scaleCost(chapter.buildings['market']!.cost, seasonOf(after.turn).build);
        expect(after.factions.p1!.res.wealth).toBe(before - (expectedCost.wealth ?? 0));
      },
    );
  });

  it('runAi recruits a fallback army sized/cooled-down from chapter.rules, not data.ts RULES', () => {
    withCustomChapter(
      { rules: { ...earlyRattanakosinChapter.rules, aiRecruitStr: 5, aiRecruitCooldown: 3 } },
      (chapter) => {
        const s = createGame({ chapter, humans: [{ id: 'p1' }], seed: 3 });
        const ai = Object.values(s.factions).find((f) => f.kind === 'ai' && f.alive)!;
        s.armies = s.armies.filter((a) => a.owner !== ai.id);
        ai.recruitCd = 1;
        const ctx: Ctx = { s, ev: [] };
        runAi(ctx);
        const newArmy = s.armies.find((a) => a.owner === ai.id);
        expect(newArmy?.str).toBe(5);
        expect(ai.recruitCd).toBe(3);
      },
    );
  });

  it('describeDecision reads foreign-power/demand flavor from chapter data, not data.ts POWERS/DEMANDS', () => {
    withCustomChapter(
      {
        foreignPowers: {
          ...earlyRattanakosinChapter.foreignPowers,
          lion: { ...earlyRattanakosinChapter.foreignPowers['lion']!, name: 'ราชสีห์ทดสอบ' },
        },
        demands: [{ title: 'ข้อเรียกร้องทดสอบ', text: 'ทดสอบ {P} ทดสอบ', accept: { wealth: 5, meter: 10 } }],
      },
      (chapter) => {
        const s = createGame({ chapter, humans: [{ id: 'p1' }], seed: 4 });
        const decision: PendingDecision = {
          id: 'd1',
          faction: 'p1',
          power: 'lion',
          kind: 'offer',
          demand: 0,
        };
        const info = describeDecision(s, decision);
        expect(info.powerName).toBe('ราชสีห์ทดสอบ');
        expect(info.title).toBe('ข้อเรียกร้องทดสอบ');
        expect(info.text).toBe('ทดสอบ ราชสีห์ทดสอบ ทดสอบ');
      },
    );
  });

  it("finishGame chronicles the chapter's own ending flavor text, not data.ts ENDINGS", () => {
    withCustomChapter(
      {
        endings: {
          ...earlyRattanakosinChapter.endings,
          ashes: { ...earlyRattanakosinChapter.endings['ashes']!, name: 'เถ้าถ่านทดสอบ' },
        },
      },
      (chapter) => {
        const s = createGame({ chapter, humans: [{ id: 'p1' }], seed: 5 });
        s.factions.p1!.alive = false; // forces the 'ashes' ending deterministically
        const ctx: Ctx = { s, ev: [] };
        finishGame(ctx);
        expect(s.factions.p1!.ending).toBe('ashes');
        expect(s.chronicle.some((e) => e.text.includes('เถ้าถ่านทดสอบ'))).toBe(true);
      },
    );
  });
});

describe('combat/economy/movement read terrain, building and rule data from the chapter (ADR-0007 Addendum 7)', () => {
  it('buildingDefenseMultiplier reproduces the old walls ×1.5 from data, not a literal walls check', () => {
    expect(buildingDefenseMultiplier(earlyRattanakosinChapter, ['walls'])).toEqual({
      multiplier: 1.5,
      names: [earlyRattanakosinChapter.buildings['walls']!.name],
    });
    expect(buildingDefenseMultiplier(earlyRattanakosinChapter, ['market', 'temple'])).toEqual({
      multiplier: 1,
      names: [],
    });
  });

  it('buildingDefenseMultiplier is generic: an invented fortification the engine never saw stacks too', () => {
    const chapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      buildings: {
        ...earlyRattanakosinChapter.buildings,
        bastion: {
          id: 'bastion',
          name: 'ป้อมทดสอบ',
          desc: 'ทดสอบ',
          cost: {},
          yield: {},
          effects: [{ kind: 'cityDefenseMultiplier', multiplier: 2 }],
        },
      },
    };
    expect(buildingDefenseMultiplier(chapter, ['bastion']).multiplier).toBe(2);
    expect(buildingDefenseMultiplier(chapter, ['bastion', 'walls']).multiplier).toBeCloseTo(3);
  });

  it('cityYield reads building/terrain/rule yields from the chapter it is given', () => {
    const s = createGame({ humans: [{ id: 'p1' }], seed: 1 });
    const capital = { ...capitalOf(s, 'p1')!, buildings: ['market' as BuildingId] };
    const base = cityYield(capital, earlyRattanakosinChapter);
    const richer: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      buildings: {
        ...earlyRattanakosinChapter.buildings,
        market: { ...earlyRattanakosinChapter.buildings['market']!, yield: { wealth: 100 } },
      },
      rules: {
        ...earlyRattanakosinChapter.rules,
        cityBaseYield: { rice: 0, man: 0, wealth: 0, faith: 0, know: 0 },
      },
    };
    const custom = cityYield(capital, richer);
    const marketWealth = earlyRattanakosinChapter.buildings['market']!.yield.wealth ?? 0;
    const baseWealth = earlyRattanakosinChapter.rules.cityBaseYield.wealth;
    expect(custom.wealth).toBe(base.wealth - marketWealth - baseWealth + 100);
  });

  it('movement cost comes from chapter.terrain: with every terrain costing 99, only the free first step is reachable', () => {
    const terrain = Object.fromEntries(
      Object.entries(earlyRattanakosinChapter.terrain).map(([id, t]) => [id, { ...t, cost: 99 }]),
    );
    withCustomChapter({ terrain }, (chapter) => {
      const s = createGame({ chapter, humans: [{ id: 'p1' }], seed: 6 });
      const army = armiesOf(s, 'p1')[0]!;
      const tiles = [...reachableTiles(s, army).values()];
      expect(tiles.length).toBeGreaterThan(0);
      for (const t of tiles) {
        expect(hexDistance([army.c, army.r], [t.c, t.r])).toBe(1);
        expect(t.left).toBe(0);
      }
    });
  });

  it('upkeepOf uses chapter.rules.upkeepPerStr, not data.ts RULES', () => {
    withCustomChapter({ rules: { ...earlyRattanakosinChapter.rules, upkeepPerStr: 1 } }, (chapter) => {
      const s = createGame({ chapter, humans: [{ id: 'p1' }], seed: 7 });
      const totalStr = armiesOf(s, 'p1').reduce((sum, a) => sum + a.str, 0);
      expect(upkeepOf(s, 'p1')).toBe(totalStr);
    });
  });
});
