# ADR-0004: Supabase JWT auth และ event sourcing (เฟส 4)

**Status:** Accepted
**Date:** 2026-09-21

## Context

เฟส 3 ใช้ player token ชั่วคราวต่อที่นั่ง (ADR-0003) และ state อยู่ใน Redis อย่างเดียว — ปิดเบราว์เซอร์
หรือ Redis รีสตาร์ตแล้วเกมหาย เฟส 4 ต้องเพิ่มบัญชีผู้ใช้จริงและทำให้เกมรอดจาก Redis หายได้

## Decision

**1. Supabase Auth แทน player token**

ผู้เล่นเข้าเกมด้วย anonymous sign-in ก่อนเสมอ (`ensureSession()` ฝั่ง web เรียกอัตโนมัติตอน hydrate/goOnline)
แล้วค่อยผูกอีเมลทีหลังผ่าน `linkEmail()` (`updateUser` ถ้ายังเป็น anonymous, ไม่งั้น `signInWithOtp`) —
บัญชี anonymous เดิมกลายเป็นบัญชีถาวรโดยเกม/เซฟไม่หาย

Server ตรวจ JWT ทุก request ผ่าน `createVerifier(config)` (`apps/server/src/auth.ts`) สองแบบ:

- **JWKS (ค่าเริ่มต้น)** — โปรเจกต์ Supabase ใหม่เซ็น JWT แบบ asymmetric, ตรวจด้วย
  `jose.createRemoteJWKSet(SUPABASE_URL + /auth/v1/.well-known/jwks.json)` ไม่ต้องมี secret ฝั่ง server เลย
- **HS256 shared secret** — โปรเจกต์เก่าที่ยังไม่ได้ย้ายไป JWT signing keys ตั้ง `SUPABASE_JWT_SECRET` แทน

ทั้งสองแบบตรวจ `issuer` และ `audience: 'authenticated'` เหมือนกัน, ปฏิเสธด้วย 401 ถ้า token หมดอายุ/เซ็นผิด/
ไม่มี `sub` claim `Verifier` เป็น interface เดียวจึงสลับ implementation หรือ inject fake ตัวใน test ได้
(ดู `apps/server/test/auth.test.ts`) — endpoint และรูปแบบ error ไม่เปลี่ยนจากที่ ADR-0003 สัญญาไว้

**2. Event sourcing: `Db` interface คู่กับ `Store`**

เพิ่ม `Db` interface (`apps/server/src/db/types.ts`) ขนานกับ `Store` เดิม — สอง implementation
(`memory.ts` สำหรับ test, `supabase.ts` ใช้ `@supabase/supabase-js` กับ service-role key จริง) `GameService`
คุมทั้งคู่:

- `create()` เขียน `db.createGame()` ก่อน (รอผลจริง, 503 ถ้าเขียนไม่สำเร็จ) แล้วค่อย `store.putGame()`
- `submit()` เขียน `db.appendAction()` **ก่อน** แก้ Redis เสมอ (durability-first) ยิง `db.putSnapshot()`
  แบบ fire-and-forget ตอนขึ้นฤดูใหม่ และ `db.markFinished()` ตอนเกมจบ
- ถ้า Redis ไม่มีเกมนั้นแล้ว (TTL หมดอายุ หรือ instance ใหม่) `loadRecord()` จะโหลดจาก
  `db.loadForReplay()` (snapshot ล่าสุด + action ที่เหลือ) แล้ว replay ผ่าน `applyAction` เดิมของ engine
  จนได้ state ปัจจุบัน (genesis สร้างใหม่ด้วย seed เดิมถ้ายังไม่เคยมี snapshot เลย เพราะ engine
  deterministic อยู่แล้ว) แล้วอุ่น cache กลับเข้า Redis

**3. Migration + RLS**

`supabase/migrations/20260918000000_init_schema.sql` สร้าง `profiles`, `games`, `game_players`,
`game_snapshots`, `game_actions` ตามร่างใน ARCHITECTURE.md เปิด RLS ทุกตาราง มีแค่ policy **อ่าน**
(`*_select_participant`, ผ่าน security-definer function `is_game_participant`) — การเขียนทั้งหมดผ่าน
service-role key ของ server เท่านั้น ซึ่ง bypass RLS โดยตรง จึงไม่ต้องมี write policy เลย

ตรวจ migration และ RLS จริงด้วย Postgres 16 local (ไม่มี Docker ใน sandbox ที่พัฒนา จึงจำลอง
schema `auth` เอง — `auth.users`, `auth.uid()` อ่านจาก GUC `request.jwt.claim.sub`) ยืนยันว่า participant
เห็นแถวของตัวเอง, คนนอกไม่เห็นอะไรเลย, เขียนด้วย role จำกัดสิทธิ์ถูกปฏิเสธ, unique constraint กันที่นั่งซ้ำทำงานถูก

## Options Considered

| ทางเลือก                               | ข้อดี                                            | ข้อเสีย                                                       |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| JWKS (asymmetric, ค่าเริ่มต้น)         | ไม่ต้องแจก/หมุน secret ฝั่ง server เลย           | ต้อง fetch JWKS ครั้งแรก (jose แคชให้เอง)                     |
| HS256 shared secret                    | เข้ากันได้กับโปรเจกต์ Supabase รุ่นเก่า          | ต้องดูแล secret เอง, หมุนยากกว่า                              |
| Event sourcing (snapshot + action log) | Redis หายได้โดยไม่เสียข้อมูล, ประวัติ replay ได้ | เขียนสองที่ทุกคำสั่ง (Redis + Postgres), ต้องทดสอบ replay เอง |
| เก็บ state เต็มทุกคำสั่งใน Postgres    | ไม่ต้อง replay                                   | เขียนหนักกว่ามาก (state ทั้งก้อนทุกคำสั่งแทนที่จะเป็น diff)   |

## Consequences

- `GameService` ต้องรอ `db.createGame()`/`db.appendAction()` เสร็จก่อนถือว่าคำสั่งสำเร็จ — เพิ่ม latency
  แลกกับ durability (snapshot/markFinished ยิงแบบ fire-and-forget เพราะไม่กระทบความถูกต้องของคำสั่งถัดไป)
- ต้องมี `SUPABASE_URL` และ (ถ้า `GAME_DB=supabase`) `SUPABASE_SERVICE_ROLE_KEY` — server จะไม่ยอมสตาร์ต
  นอก test ถ้าไม่มีทั้ง `SUPABASE_URL` และ `SUPABASE_JWT_SECRET` เลยสักอย่าง (`loadConfig` throw ตรง ๆ)
- ยังไม่มีหลายที่นั่งมนุษย์ผ่าน API (`POST /games` สร้างที่นั่งมนุษย์เดียวคือผู้สร้าง) — ห้องรอ/รหัสเชิญเพื่อ
  ชวนคนอื่นเข้าที่นั่งที่เหลือยกไปเฟส 5 ตาม ROADMAP เดิม
- ทดสอบ replay สามชั้น: engine-level equivalence, `MemoryDb` round-trip, HTTP integration ที่ทำให้ store
  หมดอายุจริงแล้วเช็คว่า `GET /games/:id` คืน state เดิมทุกบิต (`toEqual`) — ยังไม่ได้รันกับ Supabase โปรเจกต์
  จริงของผู้ใช้ (ไม่มี Docker ใน sandbox) ต้องรัน `npx supabase db reset` หรือ push migration เข้าโปรเจกต์จริงเอง
