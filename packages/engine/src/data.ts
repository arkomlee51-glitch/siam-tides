import type {
  BuildingId,
  Coord,
  Cost,
  EndingId,
  PerkId,
  PowerId,
  ResourceId,
  Resources,
  SeasonId,
  SeatId,
  TerrainId,
} from './types.js';
import type { BuildingEffect, PerkEffect } from './content/schema.js';

/**
 * Offset (odd-r) hex map, pointy-top.
 * C ที่ราบลุ่ม · K ที่ราบสูง · L ที่สูง · S คาบสมุทร · M เทือกเขา · ~ ทะเล · . นอกแผนที่
 */
export const MAP: readonly string[] = [
  '..MLLLLM......',
  '.MLLLLLLM.....',
  '.MLLLLLLKKK...',
  '.MLLLLKKKKKK..',
  '..MCCCKKKKKKK.',
  '..MCCCCKKKKKK.',
  '..MCCCCKKKKK..',
  '..MCCCCCKKKM..',
  '..MCCCCCCMMM..',
  '..MMCCCC~MM...',
  '...MSC~~~~....',
  '~~~MS~~~~~....',
  '~~~SS~~~~.....',
  '~~~SS~~~~.....',
  '~~~SS~~~~.....',
  '~~~~SS~~~.....',
  '~~~~SS~~......',
  '~~~~SSS~......',
  '~~~~~SS~......',
  '~~~~~~~.......',
];

/** River polyline (last point is the river mouth in the sea). */
export const RIVER: readonly Coord[] = [
  [4, 3],
  [4, 4],
  [4, 5],
  [4, 6],
  [5, 7],
  [5, 8],
  [6, 9],
  [7, 10],
];

export interface TerrainDef {
  id: TerrainId;
  name: string;
  short: string;
  cost: number;
  def: number;
  yield: Partial<Resources>;
  /** seasonal-disaster ids this terrain is exposed to, e.g. `['flood']` — see turn.ts */
  disasterExposure?: readonly string[];
}

export const TERRAIN: Record<TerrainId, TerrainDef> = {
  C: {
    id: 'C',
    name: 'ที่ราบลุ่มเจ้าพระยา',
    short: 'ที่ราบลุ่ม',
    cost: 1,
    def: 1.0,
    yield: { rice: 2, man: 0.5 },
    disasterExposure: ['flood'],
  },
  K: { id: 'K', name: 'ที่ราบสูงโคราช', short: 'ที่ราบสูง', cost: 1, def: 1.1, yield: { rice: 1, man: 1 } },
  L: { id: 'L', name: 'ที่สูงล้านนา', short: 'ที่สูง', cost: 2, def: 1.3, yield: { rice: 1, faith: 1 } },
  S: { id: 'S', name: 'คาบสมุทรใต้', short: 'คาบสมุทร', cost: 1, def: 1.0, yield: { wealth: 2 } },
  M: { id: 'M', name: 'เทือกเขาชายแดน', short: 'เทือกเขา', cost: 3, def: 1.5, yield: { man: 1 } },
};

export interface SeasonDef {
  id: SeasonId;
  name: string;
  icon: string;
  move: number;
  atk: number;
  build: number;
  diplo: number;
  recruit: number;
  rice: number;
  man: number;
  tip: string;
}

export const SEASONS: readonly SeasonDef[] = [
  {
    id: 'rain',
    name: 'ฤดูฝน',
    icon: '🌧️',
    move: 1,
    atk: 0.75,
    build: 1.0,
    diplo: 1.0,
    recruit: 1.3,
    rice: 0.8,
    man: 0.5,
    tip: 'เพาะปลูก ทัพเดินได้ช้า เสี่ยงน้ำท่วม',
  },
  {
    id: 'cool',
    name: 'ฤดูหนาว',
    icon: '🌬️',
    move: 3,
    atk: 1.2,
    build: 1.1,
    diplo: 1.1,
    recruit: 0.8,
    rice: 1.6,
    man: 1.0,
    tip: 'เก็บเกี่ยวข้าว และเป็นฤดูศึก ทัพเดินไกลสุด',
  },
  {
    id: 'hot',
    name: 'ฤดูร้อน',
    icon: '☀️',
    move: 2,
    atk: 0.9,
    build: 0.75,
    diplo: 0.6,
    recruit: 1.0,
    rice: 0.6,
    man: 1.3,
    tip: 'ก่อสร้างและการทูตถูกลง มหาอำนาจยื่นข้อเสนอ',
  },
];

export const RESOURCE_IDS: readonly ResourceId[] = ['rice', 'man', 'wealth', 'faith', 'know'];
export const RESOURCES: Record<ResourceId, { name: string; icon: string }> = {
  rice: { name: 'ข้าว', icon: '🌾' },
  man: { name: 'กำลังคน', icon: '👥' },
  wealth: { name: 'ทรัพย์', icon: '💰' },
  faith: { name: 'ศรัทธา', icon: '🪷' },
  know: { name: 'ความรู้', icon: '📜' },
};

export interface BuildingDef {
  id: BuildingId;
  name: string;
  desc: string;
  cost: Cost;
  yield: Partial<Resources>;
  coastalOnly?: boolean;
  garrisonBonus?: number;
  /** what it does beyond base yield, applied generically by turn.ts — see content/schema.ts */
  effects?: readonly BuildingEffect[];
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  granary: {
    id: 'granary',
    name: 'ยุ้งฉาง',
    desc: 'ข้าว +6 และลดความเสียหายจากน้ำท่วม',
    cost: { wealth: 30 },
    yield: { rice: 6 },
    effects: [{ kind: 'disasterLossReduction', disaster: 'flood', reducedLoss: 8 }],
  },
  market: {
    id: 'market',
    name: 'ตลาด',
    desc: 'ทรัพย์ +5',
    cost: { wealth: 30, rice: 10 },
    yield: { wealth: 5 },
  },
  temple: {
    id: 'temple',
    name: 'วัด',
    desc: 'ศรัทธา +3 และเสถียรภาพ +1 ทุกฤดู',
    cost: { wealth: 25, man: 5 },
    yield: { faith: 3 },
    effects: [{ kind: 'stabilityPerCity', amount: 1 }],
  },
  academy: { id: 'academy', name: 'หอความรู้', desc: 'ความรู้ +3', cost: { wealth: 40 }, yield: { know: 3 } },
  walls: {
    id: 'walls',
    name: 'กำแพงเมือง',
    desc: 'การป้องกันเมือง ×1.5',
    cost: { wealth: 30, man: 10 },
    yield: {},
    garrisonBonus: 5,
  },
  port: {
    id: 'port',
    name: 'ท่าเรือ',
    desc: 'ทรัพย์ +6 และความรู้ +1',
    cost: { wealth: 40 },
    yield: { wealth: 6, know: 1 },
    coastalOnly: true,
  },
};
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];

export const COSTS = {
  found: { wealth: 50, rice: 30, man: 10 },
  recruit: { man: 15, rice: 10, wealth: 10 },
  tribute: { wealth: 30 },
  festival: { faith: 15 },
  annex: { wealth: 50, faith: 30 },
  peace: { wealth: 40 },
  envoy: { wealth: 25 },
  negotiate: { wealth: 10, faith: 10 },
  ultimatum: { wealth: 60 },
} satisfies Record<string, Cost>;

/** Tunable balance numbers live here so designers can tweak without touching logic. */
export const RULES = {
  maxTurn: 30,
  cityMinDistance: 3,
  armyCap: 80,
  recruitNew: 20,
  recruitReinforce: 15,
  upkeepPerStr: 15,
  cityBaseYield: { rice: 4, man: 4, wealth: 6, faith: 2, know: 1 } as Resources,
  riverBonus: { rice: 1, wealth: 1 } as Partial<Resources>,
  coastalWealth: 2,
  cityDefense: 1.25,
  wallsDefense: 1.5,
  capitalDefense: 1.3,
  humanCapitalGarrison: 30,
  newCityGarrison: 8,
  newCityBaseGarrison: 12,
  capturedGarrison: 8,
  capturedBaseGarrison: 12,
  tributeGain: 12,
  festivalGain: 15,
  annexThreshold: 80,
  peaceChance: 0.65,
  peaceRelation: -20,
  warRelationCap: -60,
  envoyMeter: 10,
  envoyKnow: 4,
  balancedZone: 25,
  dangerZone: 60,
  extremeLimit: 8,
  balancedKnowBonus: 3,
  aiWarThreshold: -40,
  aiWarChance: 0.4,
  aiPeaceStrCap: 50,
  aiWarStrCap: 60,
  aiRecruitCooldown: 4,
  aiRecruitStr: 20,
  aiWeakStr: 18,
  expansionIrritation: 3,
  startResources: { rice: 60, man: 30, wealth: 80, faith: 20, know: 0 } as Resources,
  startStability: 70,
} as const;

export interface PerkDef {
  id: PerkId;
  at: number;
  name: string;
  desc: string;
  /** what it does, applied generically by economy.ts/combat.ts — see content/schema.ts */
  effects: readonly PerkEffect[];
}
export const PERKS: readonly PerkDef[] = [
  {
    id: 'irrig',
    at: 25,
    name: 'ระบบชลประทาน',
    desc: 'ผลผลิตข้าว +20%',
    effects: [{ kind: 'resourceMultiplier', resource: 'rice', multiplier: 1.2 }],
  },
  {
    id: 'powder',
    at: 60,
    name: 'ดินปืน',
    desc: 'พลังบุกและพลังรับ +20%',
    effects: [{ kind: 'combatMultiplier', multiplier: 1.2 }],
  },
  {
    id: 'print',
    at: 100,
    name: 'การพิมพ์',
    desc: 'ความรู้ +30%',
    effects: [{ kind: 'resourceMultiplier', resource: 'know', multiplier: 1.3 }],
  },
];

export interface PowerDef {
  id: PowerId;
  name: string;
  icon: string;
  side: -1 | 1;
}
export const POWERS: Record<PowerId, PowerDef> = {
  lion: { id: 'lion', name: 'ฝ่ายสิงห์ทะเล', icon: '🦁', side: -1 },
  eagle: { id: 'eagle', name: 'ฝ่ายอินทรีเหนือ', icon: '🦅', side: 1 },
};
export const POWER_IDS: readonly PowerId[] = ['lion', 'eagle'];

export interface DemandDef {
  title: string;
  /** `{P}` is replaced with the power's name */
  text: string;
  accept: { wealth?: number; know?: number; armyStr?: number; meter: number; sov?: number };
}
export const DEMANDS: readonly DemandDef[] = [
  {
    title: 'ขอตั้งสถานีการค้า',
    text: '{P} ขอสิทธิ์ตั้งสถานีการค้าที่ปากแม่น้ำ พร้อมนำสินค้าและตำราใหม่มาแลกเปลี่ยน',
    accept: { wealth: 30, know: 8, meter: 20, sov: -2 },
  },
  {
    title: 'ขอให้ลดภาษีขาเข้า',
    text: '{P} ต้องการให้ลดภาษีสินค้าของตน แลกกับการส่งช่างและวิศวกรมาช่วยงานในราชสำนัก',
    accept: { wealth: -10, know: 14, meter: 20, sov: -3 },
  },
  {
    title: 'เสนอที่ปรึกษาการทหาร',
    text: '{P} เสนอส่งนายทหารมาฝึกกองทัพของคุณ แต่หวังจะมีเสียงในที่ประชุมขุนนาง',
    accept: { armyStr: 10, meter: 25, sov: -4 },
  },
  {
    title: 'ขอเช่าที่ดินชายฝั่ง',
    text: '{P} ขอเช่าผืนดินชายฝั่งเพื่อสร้างคลังสินค้า และเสนอค่าเช่าอย่างงาม',
    accept: { wealth: 55, meter: 25, sov: -6 },
  },
];

export interface EndingDef {
  id: EndingId;
  icon: string;
  name: string;
  cond: string;
  text: string;
}
/** Evaluated top to bottom — first match wins. */
export const ENDING_ORDER: readonly EndingId[] = ['ashes', 'shadow', 'empire', 'river', 'wisdom', 'survive'];
export const ENDINGS: Record<EndingId, EndingDef> = {
  ashes: {
    id: 'ashes',
    icon: '🕯️',
    name: 'เถ้าถ่านและตำนาน',
    cond: 'เสียเมืองหลวง',
    text: 'เมืองหลวงล่มสลาย ดินแดนแตกออกเป็นรัฐเล็ก ๆ แต่เรื่องเล่าของคุณยังถูกส่งต่อ รอวันที่ผู้กอบกู้คนใหม่จะลุกขึ้นมา',
  },
  shadow: {
    id: 'shadow',
    icon: '⚓',
    name: 'ใต้ร่มเงา',
    cond: 'เอกราชต่ำกว่า 40 หรือแถบไผ่เอียงเกิน ±60 รวม 8 ฤดูขึ้นไป',
    text: 'แผ่นดินยังคงอยู่ มีราชสำนัก มีธงของตนเอง แต่นโยบายสำคัญถูกร่างขึ้นในห้องประชุมของชาติอื่น',
  },
  empire: {
    id: 'empire',
    icon: '🏛️',
    name: 'จักรวรรดิสุวรรณภูมิ',
    cond: 'ยึดเมืองด้วยกำลังอย่างน้อย 3 ครั้ง และครองเมืองอย่างน้อย 70%',
    text: 'ธงของคุณโบกสะบัดเหนือทุกหุบเขา แต่ทุกเมืองที่ยึดมายังจำความพ่ายแพ้ของตนได้ บันทึกท้ายรัชกาลเขียนว่ารอยร้าวเริ่มปรากฏจากภายใน',
  },
  river: {
    id: 'river',
    icon: '🌊',
    name: 'สายน้ำไม่ขาดสาย',
    cond: 'เอกราชอย่างน้อย 80 แถบไผ่สมดุล (±25) ครองอย่างน้อย 3 เมือง และมีทรัพย์ 100 ขึ้นไป',
    text: 'เมืองของคุณเชื่อมถึงกันด้วยแม่น้ำและเส้นทางการค้า มหาอำนาจทั้งสองฝ่ายต่างอยากเป็นมิตร แต่ไม่มีใครสั่งคุณได้',
  },
  wisdom: {
    id: 'wisdom',
    icon: '📜',
    name: 'แผ่นดินแห่งปัญญา',
    cond: 'ความรู้สะสม 150 ศรัทธาสะสม 120 และสู้รบไม่เกิน 2 ครั้ง',
    text: 'อาณาจักรไม่ได้กว้างใหญ่ที่สุด แต่นักปราชญ์และผู้แสวงบุญจากแดนไกลต่างเดินทางมาเรียนรู้',
  },
  survive: {
    id: 'survive',
    icon: '🌾',
    name: 'ลมหายใจของแผ่นดิน',
    cond: 'ไม่เข้าเงื่อนไขตอนจบอื่น',
    text: 'ไม่มีชัยชนะยิ่งใหญ่ และไม่มีความพ่ายแพ้ แผ่นดินผ่านพ้นสิบปีแห่งความผันผวนมาได้',
  },
};

export const NEW_CITY_NAMES: readonly string[] = [
  'เวียงใหม่',
  'บ้านท่าข้าม',
  'เมืองศรีนคร',
  'ปากน้ำ',
  'นครบึง',
  'เมืองแพรก',
  'เวียงพนา',
  'บางสะพาน',
];

export interface SeatDef {
  id: SeatId;
  factionName: string;
  colorToken: string;
  city: { name: string; c: number; r: number; buildings: BuildingId[]; aiGarrison: number };
  army: { c: number; r: number; aiStr: number; humanStr: number };
  /** starting AI attitude toward human seats */
  aiRelation: number;
}

/** Seat order = join order. Humans fill seats first; the rest are AI. */
export const SEATS: readonly SeatDef[] = [
  {
    id: 'center',
    factionName: 'อาณาจักรนที',
    colorToken: 'player',
    city: { name: 'กรุงนที', c: 5, r: 7, buildings: [], aiGarrison: 20 },
    army: { c: 5, r: 7, aiStr: 35, humanStr: 40 },
    aiRelation: 0,
  },
  {
    id: 'north',
    factionName: 'แคว้นเชียงดาว',
    colorToken: 'north',
    city: { name: 'เชียงดาว', c: 4, r: 1, buildings: ['temple', 'walls'], aiGarrison: 20 },
    army: { c: 4, r: 2, aiStr: 35, humanStr: 40 },
    aiRelation: 10,
  },
  {
    id: 'east',
    factionName: 'แคว้นพนมทอง',
    colorToken: 'east',
    city: { name: 'พนมทอง', c: 10, r: 4, buildings: ['walls'], aiGarrison: 20 },
    army: { c: 9, r: 4, aiStr: 35, humanStr: 40 },
    aiRelation: -10,
  },
  {
    id: 'south',
    factionName: 'แคว้นทะเลแก้ว',
    colorToken: 'south',
    city: { name: 'ทะเลแก้ว', c: 4, r: 14, buildings: ['port'], aiGarrison: 15 },
    army: { c: 4, r: 13, aiStr: 25, humanStr: 40 },
    aiRelation: 20,
  },
];
