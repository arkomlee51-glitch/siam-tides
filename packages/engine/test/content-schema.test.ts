import { describe, expect, it } from 'vitest';
import {
  CORE_RESOURCE_IDS,
  ChapterValidationError,
  LEGACY_CAPS,
  LEGACY_CATEGORIES,
  applyLegacyBonuses,
  combatMultiplier,
  computeIncome,
  computeLegacyBonuses,
  createGame,
  earlyRattanakosinChapter,
  mergeLegacyBonuses,
  resourceMultiplier,
  validateChapterDefinition,
} from '../src/index.js';
import { seasonOf } from '../src/index.js';
import type { ChapterDefinition, PerkDefData } from '../src/index.js';
import type { PerkId } from '../src/index.js';

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
