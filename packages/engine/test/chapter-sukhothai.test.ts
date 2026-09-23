import { describe, expect, it } from 'vitest';
import {
  CHAPTERS,
  CHAPTER_LIST,
  DEFAULT_CHAPTER_ID,
  createGame,
  describeDecision,
  earlyRattanakosinChapter as base,
  humanFactions,
  sukhothaiAyutthayaChapter as ch,
  validateChapterDefinition,
} from '../src/index.js';
import type { ChapterDefinition, EndingId } from '../src/index.js';
import { botSeason, checkInvariants, rng } from './helpers.js';

/** Strip every display-only field so only mechanics remain. */
function mechanics(c: ChapterDefinition) {
  return {
    map: c.map,
    river: c.river,
    terrain: c.terrain,
    seasons: c.seasons,
    rules: c.rules,
    costs: c.costs,
    buildings: Object.fromEntries(
      Object.entries(c.buildings).map(([id, b]) => [id, { ...b, name: undefined, desc: undefined }]),
    ),
    perks: c.perks.map((p) => ({ ...p, name: undefined, desc: undefined })),
    foreignPowers: Object.fromEntries(
      Object.entries(c.foreignPowers).map(([id, p]) => [id, { id: p.id, side: p.side }]),
    ),
    demands: c.demands.map((d) => d.accept),
    endings: Object.fromEntries(Object.entries(c.endings).map(([id, e]) => [id, e.cond])),
    endingOrder: c.endingOrder,
    seats: c.seats.map((s) => ({ ...s, factionName: undefined, city: { ...s.city, name: undefined } })),
  };
}

describe('บทร่าง สุโขทัย–อยุธยาตอนต้น (ADR-0009)', () => {
  it('ผ่าน validateChapterDefinition และลงทะเบียนแล้ว ติดป้ายว่ายังไม่ผ่านที่ปรึกษาประวัติศาสตร์', () => {
    expect(() => validateChapterDefinition(ch)).not.toThrow();
    expect(CHAPTERS[ch.manifest.id]).toBe(ch);
    expect(ch.manifest.historianReviewed).toBe(false);
    expect(CHAPTER_LIST.map((c) => c.manifest.order)).toEqual([3, 4]);
    expect(DEFAULT_CHAPTER_ID).toBe(base.manifest.id);
  });

  it('กลไกเหมือนบทต้นรัตนโกสินทร์ทุกประการ — ต่างกันแค่ชื่อและข้อความ (ตามที่ลีตัดสินใจ)', () => {
    expect(mechanics(ch)).toEqual(mechanics(base));
    // …และต่างกันจริงในส่วนที่เป็นหน้าตา
    expect(ch.buildings['academy']!.name).not.toBe(base.buildings['academy']!.name);
    expect(ch.foreignPowers['lion']!.name).not.toBe(base.foreignPowers['lion']!.name);
    expect(ch.flavor.ultimatum.title).not.toBe(base.flavor.ultimatum.title);
    expect(ch.seats[0]!.city.name).not.toBe(base.seats[0]!.city.name);
  });

  it('createGame ใช้เนื้อหาของบทนี้ และคำขาดใช้ข้อความของยุคนี้ ไม่ใช่เรือปืน', () => {
    const s = createGame({ chapter: ch, humans: [{ id: 'p1' }], seed: 3 });
    expect(s.chapterId).toBe('sukhothai-ayutthaya');
    expect(s.cities.find((c) => c.owner === 'p1')!.name).toBe('สุโขทัย');
    expect(s.factions.north!.name).toBe('แคว้นล้านนา');
    const info = describeDecision(s, {
      id: 'd',
      faction: 'p1',
      power: 'lion',
      kind: 'ultimatum',
      demand: -1,
    });
    expect(info.title).toBe('ทัพประชิดเมือง');
    expect(info.text).toContain('จักรวรรดิเขมร');
    expect(info.text).not.toContain('เรือ');
  });

  it('บอทเล่นจนจบเกมได้ในบทนี้ทั้งคนเดียวและหลายคน โดยไม่ละเมิด invariant', () => {
    const endings = new Set<EndingId>();
    for (let seed = 1; seed <= 20; seed++) {
      let s = createGame({ chapter: ch, seed });
      const r = rng(seed * 31);
      let seasons = 0;
      while (!s.ended && seasons++ < 40) {
        s = botSeason(s, 'p1', r, seed % 2 ? 'war' : 'peace');
        checkInvariants(s);
      }
      expect(s.ended).toBe(true);
      expect(s.chapterId).toBe(ch.manifest.id);
      endings.add(s.factions.p1!.ending as EndingId);
    }
    expect(endings.size).toBeGreaterThanOrEqual(2);

    for (let seed = 1; seed <= 5; seed++) {
      let s = createGame({ chapter: ch, seed, humans: [{ id: 'a' }, { id: 'b' }] });
      const r = rng(seed);
      let guard = 0;
      while (!s.ended && guard++ < 100) {
        for (const f of humanFactions(s)) {
          if (s.ended) break;
          s = botSeason(s, f.id, r, seed % 2 ? 'war' : 'peace');
          checkInvariants(s);
        }
      }
      expect(s.ended).toBe(true);
    }
  });

  it('chronicle ตอนจบใช้ชื่อตอนจบของบทนี้', () => {
    let s = createGame({ chapter: ch, seed: 2 });
    const r = rng(9);
    let seasons = 0;
    while (!s.ended && seasons++ < 40) s = botSeason(s, 'p1', r, 'peace');
    const ending = s.factions.p1!.ending!;
    const last = s.chronicle.filter((e) => e.faction === 'p1').at(-1)!;
    expect(last.text).toContain(ch.endings[ending]!.name);
  });
});
