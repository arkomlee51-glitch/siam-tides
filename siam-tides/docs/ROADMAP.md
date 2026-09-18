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

## เฟส 3 — Fastify server + Redis (ถัดไป)

เป้าหมาย: server เป็นผู้ตัดสิน client ส่งแค่คำสั่ง

- `POST /games` สร้างเกม, `GET /games/:id` ได้ `viewFor`, `POST /games/:id/actions` ส่งคำสั่ง
- WebSocket `/games/:id/ws` ส่ง state/event ใหม่แบบ push
- Schema ของ request ด้วย zod (+ `fastify-type-provider-zod`) ใช้ type ร่วมกับ engine
- ทุกคำสั่งมี `expectedVersion` และ `idempotencyKey`
- Redis: cache state ของเกมที่กำลังเล่น, lock ต่อเกม (`SET NX PX`), กันคำสั่งซ้ำ, rate limit
- Web: `dispatch` ส่งไป server, ทำ optimistic update ด้วย engine ในเครื่อง แล้ว reconcile ตาม version
- Logging ด้วย pino, error เป็นรูปแบบเดียวกัน `{ error, message }`
- Tests: route tests ด้วย `app.inject`, integration test กับ Redis จริง (docker ใน CI)

**เสร็จเมื่อ** เล่นเกมเดี่ยวผ่าน server ได้ครบ, ส่งคำสั่งซ้ำหรือคำสั่งเก่าแล้วถูกปฏิเสธถูกต้อง

## เฟส 4 — Supabase

เป้าหมาย: บัญชีผู้ใช้ เซฟถาวร และประวัติที่ replay ได้

- Supabase Auth (magic link + anonymous sign-in แล้วค่อยผูกบัญชี)
- Server ตรวจ JWT ของ Supabase ทุก request
- Migrations: `profiles`, `games`, `game_players`, `game_snapshots`, `game_actions` (ดู ARCHITECTURE)
- RLS: ผู้เล่นอ่านได้เฉพาะเกมที่ตนอยู่, เขียนได้เฉพาะ server (service role)
- Event sourcing: เก็บทุกคำสั่ง + snapshot ต้นฤดู → โหลดเกม = snapshot ล่าสุด + replay คำสั่ง
- หน้า "เกมของฉัน": เล่นต่อ, ดูไทม์ไลน์เกมที่จบแล้ว
- Tests: migration test ด้วย `supabase db reset`, RLS test, replay test (state จาก replay ต้องเท่ากับ state ที่เก็บ)

**เสร็จเมื่อ** ปิดเบราว์เซอร์แล้วกลับมาเล่นต่อได้บนเครื่องอื่น

## เฟส 5 — Multiplayer 2–4 คน

- ห้องรอ + รหัสเชิญ, เลือกที่นั่ง, เริ่มเกมเมื่อทุกคนพร้อม
- ฤดูกาลแบบทำพร้อมกัน: ทุกคนสั่งการ แล้วคำนวณเมื่อทุกคนกดจบฤดู (engine รองรับแล้ว)
- ตัวจับเวลาฤดู (เช่น 3 นาที) ถ้าหมดเวลาจะจบฤดูแทนผู้เล่น
- Redis pub/sub กระจาย event ข้ามหลาย instance ของ server
- เชื่อมต่อใหม่อัตโนมัติ, สถานะออนไลน์
- การทูตระหว่างมนุษย์: ข้อเสนอสงบศึก/พันธมิตรที่อีกฝ่ายต้องตอบรับ
- กำหนดว่าตอนจบแต่ละแบบหมายถึงอะไรในเกมหลายคน (อันดับ, ชนะร่วม)

**เสร็จเมื่อ** 4 คนเล่นจนจบได้โดยไม่ desync และ reconnect กลางเกมได้

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
