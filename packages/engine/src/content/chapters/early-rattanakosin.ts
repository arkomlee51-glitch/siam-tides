import {
  BUILDINGS,
  COSTS,
  DEMANDS,
  ENDING_ORDER,
  ENDINGS,
  MAP,
  NEW_CITY_NAMES,
  PERKS,
  POWERS,
  RESOURCES,
  RIVER,
  RULES,
  SEASONS,
  SEATS,
  TERRAIN,
} from '../../data.js';
import type { ChapterDefinition } from '../schema.js';
import { CORE_RESOURCE_IDS } from '../schema.js';

/**
 * The chapter the game ships with today (data.ts), re-expressed in the Phase 6
 * `ChapterDefinition` shape — built BY DERIVING from the same `data.ts` exports the
 * live single-chapter game already uses (not hand-retyped), so this file can never
 * drift out of sync with what actually ships, and so the ~400 lines of tuned content
 * in data.ts only exist in one place.
 *
 * Placement in the six-chapter arc (see docs/ROADMAP.md เฟส 6) is a placeholder
 * pending the historian review the roadmap calls for, but "a small kingdom bending
 * like bamboo between two great powers, risking becoming a shadow/protectorate of
 * either" is specifically early Rattanakosin's real diplomatic history (Rama III–V
 * navigating British and French colonial pressure), not a generic fit — hence
 * chapter 4 of 6, not chapter 1 or 6.
 */
export const earlyRattanakosinChapter: ChapterDefinition = {
  manifest: {
    id: 'early-rattanakosin',
    order: 4,
    name: 'ต้นรัตนโกสินทร์',
    era: 'รัชกาลที่ 3–5',
    yearsLabel: 'พ.ศ. 2367–2453 (โดยประมาณ)',
    summary:
      'สยามต้องรักษาเอกราชท่ามกลางแรงกดดันจากสองมหาอำนาจตะวันตก ด้วยการทูตแบบ "ไผ่ลู่ลม" — โน้มไปทางใดทางหนึ่งมากเกินไปเสี่ยงกลายเป็นรัฐใต้อาณัติ',
    historianReviewed: false,
  },
  map: MAP,
  river: RIVER,
  terrain: TERRAIN,
  terrainOrder: ['C', 'K', 'L', 'S', 'M'],
  seasons: SEASONS,
  resourceLabels: Object.fromEntries(
    CORE_RESOURCE_IDS.map((id) => [id, RESOURCES[id]]),
  ) as ChapterDefinition['resourceLabels'],
  buildings: BUILDINGS,
  costs: COSTS,
  rules: RULES,
  perks: PERKS,
  foreignPowers: POWERS,
  demands: DEMANDS,
  endings: ENDINGS,
  endingOrder: ENDING_ORDER,
  seats: SEATS,
  newCityNames: NEW_CITY_NAMES,
  // exactly the text that used to be hard-coded in powers.ts/views.ts/Modals.tsx
  flavor: {
    ultimatum: {
      icon: '⚓',
      title: 'เรือปืนปิดปากแม่น้ำ',
      text: 'ความอดทนของ{P}หมดลง เรือรบทอดสมออยู่หน้าเมืองและรอคำตอบก่อนพลบค่ำ',
      arrivedLog: 'เรือปืนของ{P}ปิดปากแม่น้ำ',
      paidChronicle: 'จ่ายค่าชดเชยเพื่อคลี่คลายวิกฤตเรือปืน',
    },
    intro: {
      kicker: 'ต้นแบบบทไผ่ลู่ลม',
      heading: 'ทุกสิ่งเริ่มจากการตัดสินใจครั้งแรกของคุณ',
      body: 'คุณปกครอง{capital}ริมแม่น้ำ รอบข้างมีแคว้นอิสระสามแคว้น และมหาอำนาจทางทะเลสองฝ่ายที่ต่างอยากมีอิทธิพลเหนือราชสำนัก คุณมีเวลา{years}ปี',
    },
  },
};
