# ADR-0001: Engine เดียวใช้ร่วมกัน และ server เป็นผู้ตัดสิน

**Status:** Accepted
**Date:** 2026-09-18

## Context

เกมต้องรองรับ multiplayer 2–4 คนและกันโกง ต้นแบบเขียนกติกาปนกับ DOM และใช้ `Math.random`

## Decision

แยกกติกาเป็น `@siam/engine` แบบ pure และ deterministic ให้ทั้ง web และ server import ตัวเดียวกัน
server รัน engine กับทุกคำสั่งและเป็นผู้ตัดสิน client ใช้ engine เพื่อ optimistic update

## Options Considered

| ทางเลือก                       | ข้อดี                                 | ข้อเสีย                              |
| ------------------------------ | ------------------------------------- | ------------------------------------ |
| A: engine ร่วม + server ตัดสิน | กันโกง, replay ได้, ไม่มีโค้ดกติกาซ้ำ | ต้องรักษา determinism อย่างเคร่งครัด |
| B: client ตัดสิน server เก็บผล | ง่ายสุด                               | โกงง่าย, multiplayer desync          |
| C: server อย่างเดียว           | กันโกงดี                              | UI หน่วงทุกคลิก, เล่นออฟไลน์ไม่ได้   |

## Consequences

- ง่ายขึ้น: replay/audit, test กติกาโดยไม่ต้องมี UI, simulation ปรับสมดุล
- ยากขึ้น: ห้ามใช้ `Math.random`/`Date.now` ใน engine, ต้อง version state (`schemaVersion`) และ engine
- ต้องกลับมาดู: migration ของ state เมื่อ schema เปลี่ยน
