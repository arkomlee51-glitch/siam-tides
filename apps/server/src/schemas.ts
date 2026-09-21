import { z } from 'zod';
import type { Action, BuildingId, DecisionChoice, PowerId } from '@siam/engine';

/* ---------- ตรวจว่า schema ตรงกับชนิดใน engine ตอน typecheck ---------- */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const BUILDING_IDS = ['granary', 'market', 'temple', 'academy', 'walls', 'port'] as const;
const POWER_IDS = ['lion', 'eagle'] as const;
const DECISION_CHOICES = ['accept', 'negotiate', 'decline', 'pay', 'yield'] as const;

export type _BuildingIdsCovered = Assert<Equals<(typeof BUILDING_IDS)[number], BuildingId>>;
export type _PowerIdsCovered = Assert<Equals<(typeof POWER_IDS)[number], PowerId>>;
export type _DecisionChoicesCovered = Assert<Equals<(typeof DECISION_CHOICES)[number], DecisionChoice>>;

const id = z.string().min(1).max(64);
const coord = z.number().int().min(-99).max(99);

/** คำสั่งทั้ง 14 แบบ — ต้องตรงกับ `Action` ใน engine เสมอ */
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), armyId: id, c: coord, r: coord }),
  z.object({ type: z.literal('attack'), armyId: id, c: coord, r: coord }),
  z.object({ type: z.literal('camp'), armyId: id }),
  z.object({ type: z.literal('found'), armyId: id }),
  z.object({ type: z.literal('build'), cityId: id, building: z.enum(BUILDING_IDS) }),
  z.object({ type: z.literal('recruit'), cityId: id }),
  z.object({ type: z.literal('tribute'), target: id }),
  z.object({ type: z.literal('festival'), target: id }),
  z.object({ type: z.literal('annex'), target: id }),
  z.object({ type: z.literal('declareWar'), target: id }),
  z.object({ type: z.literal('offerPeace'), target: id }),
  z.object({ type: z.literal('envoy'), power: z.enum(POWER_IDS) }),
  z.object({ type: z.literal('answerDecision'), decisionId: id, choice: z.enum(DECISION_CHOICES) }),
  z.object({ type: z.literal('endTurn') }),
]);

export type _ActionSchemaMatchesEngine = Assert<Equals<z.infer<typeof ActionSchema>, Action>>;

/* ---------- requests ---------- */
export const CreateGameBody = z.object({
  seed: z.coerce.number().int().min(0).max(0xffffffff).optional(),
  maxTurn: z.coerce.number().int().min(1).max(120).optional(),
  /** ชื่ออาณาจักรของผู้สร้าง (ที่นั่ง p1) — ที่นั่งอื่นเป็น AI จนกว่าจะมีห้องรอ/รหัสเชิญในเฟส 5 */
  name: z.string().trim().min(1).max(40).optional(),
});
export type CreateGameInput = z.infer<typeof CreateGameBody>;

export const GameParams = z.object({ id: z.string().uuid() });

export const SubmitActionBody = z.object({
  action: ActionSchema,
  /** version ที่ client คิดว่าเป็นปัจจุบัน ไม่ตรง = 409 */
  expectedVersion: z.number().int().min(0),
  /** ส่งซ้ำด้วย key เดิมจะได้ผลลัพธ์เดิม ไม่ถูกใช้สองครั้ง */
  idempotencyKey: z.string().min(8).max(120),
});
export type SubmitActionInput = z.infer<typeof SubmitActionBody>;

export const WsQuery = z.object({ token: z.string().min(1).max(200).optional() });

/* ---------- เฟส 5: ห้องรอ/รหัสเชิญ ---------- */
export const CreateLobbyBody = z.object({
  seed: z.coerce.number().int().min(0).max(0xffffffff).optional(),
  maxTurn: z.coerce.number().int().min(1).max(120).optional(),
  /** ชื่อของผู้สร้างห้อง (host ได้ที่นั่ง p1 เสมอตอน start) */
  name: z.string().trim().min(1).max(40).optional(),
});
export type CreateLobbyInput = z.infer<typeof CreateLobbyBody>;

/** รหัสเชิญ 6 หลัก ตัวพิมพ์ใหญ่ + เลข ตัด 0/O/1/I/L ที่อ่านสับสนออกแล้วตอนสุ่ม (ดู game/lobby.ts) */
export const LobbyParams = z.object({ code: z.string().trim().toUpperCase().length(6) });

export const JoinLobbyBody = z.object({
  name: z.string().trim().min(1).max(40).optional(),
});
export type JoinLobbyInput = z.infer<typeof JoinLobbyBody>;

