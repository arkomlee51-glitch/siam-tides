import { COSTS, DEMANDS, POWERS } from './data.js';
import { canPay, scaleCost } from './economy.js';
import { choicesFor, negotiateCost } from './powers.js';
import { seasonOf, visibleTo } from './state.js';
import type { DecisionChoice, FactionId, GameState, PendingDecision } from './types.js';

/**
 * What one player is allowed to see. Other humans' treasuries and private events are hidden.
 * The server must send only this, never the raw state.
 */
export function viewFor(s: GameState, fid: FactionId): GameState {
  const v = structuredClone(s);
  v.log = v.log.filter((e) => visibleTo(e, fid));
  v.pending = v.pending.filter((p) => p.faction === fid);
  v.rng = 0;
  for (const f of Object.values(v.factions)) {
    if (f.id === fid || f.kind !== 'human') continue;
    f.res = { rice: 0, man: 0, wealth: 0, faith: 0, know: 0 };
  }
  return v;
}

export interface DecisionOption {
  choice: DecisionChoice;
  label: string;
  detail: string;
  enabled: boolean;
}
export interface DecisionInfo {
  id: string;
  powerName: string;
  powerIcon: string;
  title: string;
  text: string;
  options: DecisionOption[];
}

export function describeDecision(s: GameState, d: PendingDecision): DecisionInfo {
  const P = POWERS[d.power];
  const f = s.factions[d.faction]!;
  const arrow = P.side < 0 ? '←' : '→';
  if (d.kind === 'ultimatum') {
    return {
      id: d.id,
      powerName: P.name,
      powerIcon: '⚓',
      title: 'เรือปืนปิดปากแม่น้ำ',
      text: `ความอดทนของ${P.name}หมดลง เรือรบทอดสมออยู่หน้าเมืองและรอคำตอบก่อนพลบค่ำ`,
      options: [
        {
          choice: 'pay',
          label: 'จ่ายค่าชดเชย',
          detail: `💰${COSTS.ultimatum.wealth} ความอดทนกลับมาเป็น 2`,
          enabled: canPay(f.res, COSTS.ultimatum),
        },
        {
          choice: 'yield',
          label: 'ยอมตามข้อเรียกร้อง',
          detail: `เอกราช −15, แถบไผ่ ${arrow} 30`,
          enabled: true,
        },
      ],
    };
  }
  const D = DEMANDS[d.demand]!;
  const eff = (half: boolean) => {
    const h = (v: number) => (half ? Math.round(v / 2) : v);
    const parts: string[] = [];
    if (D.accept.wealth) parts.push(`💰${h(D.accept.wealth) > 0 ? '+' : ''}${h(D.accept.wealth)}`);
    if (D.accept.know) parts.push(`📜+${h(D.accept.know)}`);
    if (D.accept.armyStr) parts.push(`ทัพทุกกอง +${h(D.accept.armyStr)}`);
    parts.push(`ไผ่ ${arrow} ${h(D.accept.meter)}`);
    if (!half && D.accept.sov) parts.push(`เอกราช ${D.accept.sov}`);
    return parts.join(', ');
  };
  const neg = negotiateCost(s);
  const detail: Record<string, string> = {
    accept: eff(false),
    negotiate: `จ่าย ${fmtCost(neg)} ได้ผลครึ่งเดียว (${eff(true)}) และไม่เสียเอกราช`,
    decline: 'ความอดทน −1, แถบไผ่เอนกลับ 6',
  };
  const labels: Record<string, string> = {
    accept: 'ยอมรับ',
    negotiate: 'ต่อรองแบบไผ่ลู่ลม',
    decline: 'ปฏิเสธอย่างสุภาพ',
  };
  return {
    id: d.id,
    powerName: P.name,
    powerIcon: P.icon,
    title: D.title,
    text: D.text.replace('{P}', P.name),
    options: choicesFor(d).map((choice) => ({
      choice,
      label: labels[choice]!,
      detail: detail[choice]!,
      enabled: choice !== 'negotiate' || canPay(f.res, neg),
    })),
  };
}

export function fmtCost(cost: ReturnType<typeof scaleCost>): string {
  const icons = { rice: '🌾', man: '👥', wealth: '💰', faith: '🪷', know: '📜' } as const;
  return (Object.keys(cost) as (keyof typeof icons)[]).map((k) => `${icons[k]}${cost[k]}`).join(' ');
}

/** Season-adjusted cost helper for UIs. */
export function seasonalCost(
  s: GameState,
  base: Parameters<typeof scaleCost>[0],
  kind: 'build' | 'diplo' | 'recruit',
) {
  return scaleCost(base, seasonOf(s.turn)[kind]);
}
