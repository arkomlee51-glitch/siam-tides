# ADR-0002: Supabase สำหรับข้อมูลถาวร, Redis สำหรับข้อมูลร้อน

**Status:** Accepted
**Date:** 2026-09-18

## Context

ต้องการ auth, เซฟถาวร, ประวัติการเล่น และ realtime สำหรับ multiplayer โดยทีมเล็ก

## Decision

- Supabase: Auth, Postgres (games, players, snapshots, action log), RLS
- Redis: state เกมที่กำลังเล่น, lock, idempotency, pub/sub, rate limit
- Realtime ผ่าน WebSocket ของ Fastify (ไม่ใช้ Supabase Realtime) เพื่อให้ server คุมการกรองข้อมูลตามผู้เล่น (`viewFor`) ได้เต็มที่

## Options Considered

| ทางเลือก                            | ข้อดี                                | ข้อเสีย                                                     |
| ----------------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| Supabase + Redis + Fastify WS       | แยกหน้าที่ชัด, server คุม fog of war | ต้องดูแล 2 ที่เก็บข้อมูล                                    |
| Supabase อย่างเดียว (Realtime + DB) | infra น้อย                           | กรองข้อมูลรายผู้เล่นยาก, lock/idempotency ต้องทำใน Postgres |
| Postgres เองทั้งหมด                 | ควบคุมเต็มที่                        | ต้องทำ auth เอง                                             |

## Consequences

- Redis หายได้โดยไม่เสียข้อมูล เพราะโหลดคืนจาก snapshot + action log ได้
- ต้องเขียน replay และทดสอบว่า replay ได้ state เท่าเดิม (engine deterministic อยู่แล้ว)
