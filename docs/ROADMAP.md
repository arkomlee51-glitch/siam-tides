# Roadmap

แต่ละเฟสจบด้วยเกณฑ์ "เสร็จ" ที่ตรวจได้ และทำให้ `npm run lint && npm run typecheck && npm test && npm run build` ผ่านทุกครั้ง
ทำทีละเฟสบน branch `phase-N-...` แล้ว merge เข้า `main` พร้อม tag

---

## เฟส 0 — โครง repo ✅

- npm workspaces: `packages/engine`, `apps/web`, `apps/server`
- TypeScript strict (`noUncheckedIndexedAccess`), ESLint (typescript-eslint), Prettier, EditorConfig
- Vitest, GitHub Actions CI (lint → typecheck → test → build)
- `docker-compose.yml` สำหรับ Redis, `.env.example`
- Server มี `GET /health`, web มีหน้าตัวยึดที่รัน engine ได้จริง

**เสร็จเมื่อ** CI เขียว, `npm run dev:web` และ `npm run dev:server` รันได้

## เฟส 1 — Rules engine ✅

ย้ายกติกาทั้งหมดจากต้นแบบมาเป็น TypeScript ที่ไม่มี DOM และไม่มี framework

- `applyAction(state, factionId, action)` เป็นทางเดียวที่เปลี่ยน state (pure, ไม่แก้ input)
- คำสั่ง 14 แบบ พร้อม error code ที่มีชนิด (`ActionError`) และข้อความภาษาไทย
- Seeded RNG (mulberry32) เก็บใน state → seed + ลำดับคำสั่งเดิม = ผลเดิมทุกครั้ง
- รองรับผู้เล่นมนุษย์ 1–4 คนตั้งแต่ต้น (นั่งที่ center, north, east, south ส่วนที่เหลือเป็น AI)
- ฤดูกาลจะคำนวณเมื่อมนุษย์ทุกคนกด `endTurn` (พร้อมสำหรับ multiplayer)
- ข้อเสนอมหาอำนาจเป็น `pending` decision ใน state แทน modal
- `viewFor(state, factionId)` ซ่อนคลังของผู้เล่นอื่นและ event ส่วนตัว
- 24 tests: hex math, determinism, economy, validation, great powers, diplomacy, endings,
  simulation 40 เกมเดี่ยว + 10 เกมหลายคน พร้อมตรวจ invariant ทุกฤดู

**เสร็จเมื่อ** พฤติกรรมตรงกับต้นแบบ และ tests ผ่าน

---

## เฟส 2 — Web client เล่นคนเดียว ✅

เล่นได้เท่าต้นแบบ แต่โครงพร้อมต่อ server

- Zustand store (`src/store.ts`): ถือ `GameState`, การเลือกช่อง, คิว modal และ `dispatch(action)` ที่เรียก engine ในเครื่อง
  (เฟส 3 จะสลับให้ `dispatch` ยิงไป server แล้ว reconcile)
- PixiJS v8 renderer (`src/map/MapRenderer.ts`) แยกเป็น layer: terrain (วาดครั้งเดียวต่อธีม) →
  territory/borders → highlights → cities/armies
- เรขาคณิตแผนที่แยกเป็นฟังก์ชัน pure (`src/map/geometry.ts`) จึงเทสต์ได้โดยไม่ต้องมี WebGL
- กล้อง: ลากเพื่อเลื่อน, ล้อเมาส์และสองนิ้วเพื่อซูม, ปุ่มพอดีจอ, เลือกช่องด้วย `pixelToHex`
- ธีม: `src/theme.ts` เป็นต้นทางเดียวของสี ให้ทั้ง CSS variables และ PixiJS, สลับ auto/light/dark
- UI ครบตามต้นแบบ: HUD ฤดูกาล, แผงข้อมูล/การทูต/ไผ่ลู่ลม/เป้าหมาย/บันทึก, modal ข้อเสนอมหาอำนาจ,
  รายงานศึก, สรุปฤดู, ฉากจบพร้อมไทม์ไลน์
- เซฟอัตโนมัติลง IndexedDB ทุกครั้งที่ state เปลี่ยน และโหลดต่อเมื่อเปิดใหม่
- 17 tests: geometry, store (เดินทัพ, โจมตี, คำสั่งที่ถูกปฏิเสธ, คิว modal), component tests ของ HUD/แผง/modal

**ยังไม่ทำ (ยกไปเฟส 3 หรือ 6)**

- Playwright smoke test (ยังไม่ได้ติดตั้งในสภาพแวดล้อมนี้)
- แอนิเมชันการเดินทัพและการรบ ตอนนี้แผนที่วาดใหม่ทันทีแบบไม่มี transition
- ตรวจ Lighthouse บนมือถือ

## เฟส 3 — Fastify server + Redis ✅

server เป็นผู้ตัดสิน client ส่งแค่คำสั่ง

- `POST /games` สร้างเกม (1–4 ที่นั่ง) และออก player token ให้ทีละที่นั่ง,
  `GET /games/:id` ได้ `viewFor` ของ token นั้น, `POST /games/:id/actions` ส่งคำสั่ง
- WebSocket `/games/:id/ws` — subscribe ก่อนแล้วจึงส่ง `sync` เพื่อไม่ให้พลาด update ระหว่างเชื่อมต่อ
  แล้ว push `update` (view + event เฉพาะที่ผู้เล่นคนนั้นเห็นได้) ทุกครั้งที่มีคำสั่งถูกใช้
- Schema ของ request ด้วย zod (+ `fastify-type-provider-zod`) และมี type-level check ว่า
  `ActionSchema` ตรงกับ `Action` ของ engine เสมอ (typecheck พังถ้าเพิ่มคำสั่งแล้วลืมแก้ schema)
- ทุกคำสั่งมี `expectedVersion` (ไม่ตรง = 409 พร้อม view ล่าสุด) และ `idempotencyKey`
  (ส่งซ้ำได้ผลเดิม ไม่ถูกใช้สองครั้ง — ผลที่ถูกปฏิเสธก็จำไว้ด้วย)
- Store แยกเป็น interface เดียวกันสองตัว: Redis (state + lock `SET NX PX` + compare-and-del,
  idempotency, rate limit, pub/sub) และ in-memory สำหรับ test/dev ที่ไม่ได้รัน Redis
- Web: `dispatch` ตรวจคำสั่งด้วย engine ในเครื่องเพื่อ feedback ทันที แล้วส่งไป server;
  คำสั่งที่ไม่มีการสุ่มอัปเดตหน้าจอก่อน (optimistic) และ reconcile ตาม version,
  คำสั่งที่มีการสุ่ม (โจมตี/ขอสงบศึก/จบฤดู) รอผลจาก server; สลับโหมด local/server ได้จาก HUD
- Logging ด้วย pino, error รูปแบบเดียวกันทั้งระบบ `{ error, message, details? }`
- 34 tests ฝั่ง server: route tests ด้วย `app.inject`, lock/idempotency แบบยิงพร้อมกัน,
  WebSocket ด้วย `injectWS`, store contract ที่รันซ้ำกับ Redis จริง และ integration test
  ที่ push ข้าม instance ของ server ผ่าน Redis pub/sub (`TEST_REDIS=1`)
- 24 tests ฝั่ง web รวมโหมด server: optimistic, reconcile, 409, คำสั่งที่ถูกปฏิเสธในเครื่อง

**ยังไม่ทำ (ยกไปเฟส 4 หรือ 5)**

- ยังไม่มีบัญชีผู้ใช้จริง — player token คือใบผ่านของที่นั่ง (ADR-0003) เฟส 4 จะเปลี่ยนเป็น Supabase JWT
- state อยู่ใน Redis เท่านั้น มี TTL ยังไม่มี Postgres รองรับ (เฟส 4)
- ห้องรอ/รหัสเชิญ และตัวจับเวลาฤดู (เฟส 5)

## เฟส 4 — Supabase ✅

เป้าหมาย: บัญชีผู้ใช้ เซฟถาวร และประวัติที่ replay ได้

- Supabase Auth: anonymous sign-in อัตโนมัติตอนเปิดเกม (`ensureSession()`) แล้วผูกอีเมลทีหลังได้
  (`linkEmail()` ในหน้า "บัญชี") — บัญชี anonymous เดิมกลายเป็นบัญชีถาวร เกม/เซฟเดิมไม่หาย
- Server ตรวจ JWT ของ Supabase ทุก request ด้วย JWKS เป็นค่าเริ่มต้น (หรือ HS256 secret สำหรับโปรเจกต์เก่า)
  ดู [ADR-0004](adr/0004-supabase-jwt-auth-and-event-sourcing.md)
- Migrations: `profiles`, `game_players`, `games`, `game_snapshots`, `game_actions`
  (`supabase/migrations/20260918000000_init_schema.sql`) — ตรวจจริงด้วย Postgres 16 local
- RLS: ผู้เล่นอ่านได้เฉพาะเกมที่ตนอยู่ (ผ่าน `is_game_participant`), เขียนได้เฉพาะ server (service role) เท่านั้น
- Event sourcing: `GameService` เขียน `game_actions` ก่อนเสมอ (รอผลจริง) ก่อนแก้ Redis, snapshot ต้นฤดูใหม่
  แบบ fire-and-forget → Redis หมดอายุหรือ instance ใหม่โหลด snapshot ล่าสุด + replay คำสั่งที่เหลือแทน
- หน้า "บัญชี": ผูกอีเมล, ดูรายชื่อ "เกมของฉัน" พร้อมปุ่มเล่นต่อ (`GET`-ary query ผ่าน Supabase client ตรง ๆ
  จาก `game_players` join `games`)
- Tests: replay ตรวจสามชั้น — engine-level equivalence, `MemoryDb` round-trip
  (`apps/server/test/db.test.ts`), HTTP integration ที่ทำให้ Redis หมดอายุจริงแล้วเช็คว่า
  `GET /games/:id` คืน state เดิมทุกบิต (`apps/server/test/replay.test.ts`); auth ตรวจ HS256 JWT
  ทุกเคส (`apps/server/test/auth.test.ts`); migration/RLS ตรวจด้วย Postgres local (ไม่ใช่ `supabase db reset`
  เพราะไม่มี Docker ในสภาพแวดล้อมที่พัฒนา)

**เสร็จเมื่อ** ปิดเบราว์เซอร์แล้วกลับมาเล่นต่อได้บนเครื่องอื่น

**ยังไม่ทำ / ต้องทำต่อ**

- ยังไม่ได้รันกับโปรเจกต์ Supabase จริงของผู้ใช้ — ต้องเติม `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY`
  ใน `.env` แล้ว push migration (`npx supabase db push` หรือรันผ่าน SQL editor ของ dashboard) เอง
- หลายที่นั่งมนุษย์ผ่าน API ยังทำไม่ได้ (`POST /games` สร้างที่นั่งมนุษย์เดียวคือผู้สร้าง) — ห้องรอ/รหัสเชิญ
  เพื่อชวนคนอื่นเข้าที่นั่งที่เหลือยกไปเฟส 5 ตามแผนเดิม

## เฟส 5 — Multiplayer 2–4 คน (เริ่มแล้ว)

- [x] ห้องรอ + รหัสเชิญ (6 หลัก), เลือกที่นั่งตามลำดับเข้าร่วม, host เริ่มเกมเมื่อพร้อม
      (`POST /lobbies`, `/lobbies/:code/{join,leave,start}` — ดู [ADR-0005](adr/0005-lobby-and-invite-codes.md))
- [x] ฤดูกาลแบบทำพร้อมกัน: ทุกคนสั่งการ แล้วคำนวณเมื่อมนุษย์ทุกคนกดจบฤดู — engine รองรับมาตั้งแต่เฟส 1
      (`state.ready` ใน `packages/engine/src/actions.ts`) ยืนยันแล้วผ่าน API จริงด้วยเทสต์ 2 คน
      (`apps/server/test/lobby.test.ts`)
- [ ] ตัวจับเวลาฤดู (เช่น 3 นาที) ถ้าหมดเวลาจะจบฤดูแทนผู้เล่น
- [ ] ยืนยัน Redis pub/sub ข้าม instance กับห้องรอ/เกมหลายคนจริง (โครงมีอยู่แล้วตั้งแต่เฟส 3 แต่ยังไม่ได้
      ทดสอบร่วมกับห้องรอ)
- [ ] เชื่อมต่อใหม่อัตโนมัติกับเกมหลายคนจริง (WebSocket เดิมมี backoff reconnect อยู่แล้วสำหรับผู้เล่นเดี่ยว
      แต่ยังไม่ได้ทดสอบ 4 คนพร้อมกัน + จำลองสายหลุด)
- [ ] การทูตระหว่างมนุษย์: ข้อเสนอสงบศึก/พันธมิตรที่อีกฝ่ายต้องตอบรับ — ตอนนี้ `offerPeace` ทำได้แค่กับ AI
      เท่านั้น (ดูคอมเมนต์ `// Human-to-human peace needs a proposal/accept flow` ใน
      `packages/engine/src/actions.ts`) ต้องขยาย `PendingDecision` ของ engine ให้รองรับ
- [ ] กำหนดว่าตอนจบแต่ละแบบหมายถึงอะไรในเกมหลายคน (อันดับ, ชนะร่วม) — `endings.ts` ยังคิดแบบต่อคนเดียว

**เสร็จเมื่อ** 4 คนเล่นจนจบได้โดยไม่ desync และ reconnect กลางเกมได้ — ยังไม่ถึงเกณฑ์นี้ (มีแค่ path
สร้างห้อง+เข้าร่วม+เริ่มเกมที่ทดสอบแล้วสำหรับ ≤4 ที่นั่ง)

## เฟส 6 — เนื้อหาเต็ม

- 6 บท (ก่อนประวัติศาสตร์ → ปัจจุบัน) เป็น content แบบ data-driven (JSON + schema)
- ระบบ Legacy: สิ่งก่อสร้างในบทก่อนกลายเป็นโบนัสถาวรในบทถัดไป (มีเพดานกัน snowball)
- Tech tree ต่อยุค, การ์ดขุนพล, Tactical View แบบ hex ย่อย
- Timeline Replay เทียบกับประวัติศาสตร์จริงพร้อมเกร็ดความรู้
- ตรวจเนื้อหากับที่ปรึกษาด้านประวัติศาสตร์ และระวังการนำเสนอรัฐเพื่อนบ้าน
- เครื่องมือปรับสมดุล: รัน simulation หลายพันเกมแล้วดูสัดส่วนตอนจบ

## เฟส 7 — Production

- Deploy: web → Vercel, server → Fly.io หรือ Render, Redis → Upstash, Supabase Cloud
- Sentry + log/metrics, health check, alert
- Load test WebSocket, ทดสอบ failover ของ Redis
- Preview environment ต่อ pull request
- เก็บ telemetry การเล่น (ไม่ระบุตัวตน) เพื่อปรับสมดุล
