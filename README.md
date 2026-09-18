# 🎋 Siam: Tides of the Kingdom

เกมวางแผนผลัดตา (4X/Grand Strategy) บนเว็บ ดินแดนนี้อยู่รอดด้วยการทูตและการปรับตัว ไม่ใช่กำลังทหารอย่างเดียว

> ต้นแบบ HTML ไฟล์เดียวที่เล่นได้อยู่ใน [`prototype/index.html`](prototype/index.html) ใช้เป็นตัวอ้างอิงพฤติกรรมของเกม

## สถานะ

| เฟส | งาน                                     | สถานะ    |
| --- | --------------------------------------- | -------- |
| 0   | โครง monorepo, tooling, CI              | ✅ เสร็จ |
| 1   | Rules engine แบบ deterministic + tests  | ✅ เสร็จ |
| 2   | Web client เล่นคนเดียว (React + PixiJS) | ✅ เสร็จ |
| 3   | Fastify server + Redis                  | ✅ เสร็จ |
| 4   | Supabase (auth, save, event log)        | ⏳ ถัดไป |
| 5   | Multiplayer 2–4 คน                      | —        |
| 6   | เนื้อหาเต็ม 6 บท + Legacy               | —        |
| 7   | Production                              | —        |

รายละเอียดแต่ละเฟสอยู่ใน [docs/ROADMAP.md](docs/ROADMAP.md) และสถาปัตยกรรมอยู่ใน [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## โครงสร้าง

```
packages/engine   กติกาเกมทั้งหมด (TypeScript ล้วน ไม่มี framework) ใช้ร่วมกันทั้ง web และ server
apps/web          React + Vite + PixiJS + Zustand
apps/server       Fastify + Redis (Supabase ในเฟส 4)
supabase/         migrations (เฟส 4)
prototype/        ต้นแบบ HTML ไฟล์เดียว
docs/             roadmap, architecture, ADR
```

## เริ่มใช้งาน

ต้องมี Node 22 (ดู `.nvmrc`) และ Docker ถ้าจะรัน Redis

```bash
npm install
npm test              # engine + server tests
npm run dev:web       # http://localhost:5173
npm run dev:server    # http://localhost:8787/health
docker compose up -d  # Redis (ใช้ตั้งแต่เฟส 3)
```

คำสั่งอื่น: `npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`

### เล่นผ่าน server (เฟส 3)

```bash
docker compose up -d    # Redis
npm run dev:server      # http://localhost:8787
npm run dev:web         # แล้วกดปุ่ม "เล่นผ่าน server" บน HUD
```

server ใช้ Redis เป็นค่าเริ่มต้น ถ้ายังไม่อยากรัน Redis ให้ตั้ง `GAME_STORE=memory`
(state จะอยู่ในหน่วยความจำของ process เดียว) รายละเอียด endpoint ทั้งหมดอยู่ใน [docs/API.md](docs/API.md)

test ที่ต้องใช้ Redis จริงจะถูกข้ามโดยปริยาย เปิดด้วย:

```bash
docker compose up -d && TEST_REDIS=1 npm test
```

### Supabase (เฟส 4)

```bash
npx supabase init     # ครั้งแรก
npx supabase start    # รัน local stack แล้วคัดลอก key ไปใส่ .env
```

## ขึ้น GitHub

```bash
# สร้าง repo เปล่าบน GitHub ก่อน (ไม่ต้องติ๊ก README) แล้ว
git remote add origin git@github.com:<you>/siam-tides.git
git push -u origin main --tags
```

หรือใช้ GitHub CLI: `gh repo create siam-tides --private --source=. --push`

## หลักการสำคัญ

- **Engine เป็นแหล่งความจริงเดียว** ทุกการเปลี่ยนสถานะเกมต้องผ่าน `applyAction(state, factionId, action)` ซึ่งเป็น pure function
- **Deterministic** การสุ่มทั้งหมดใช้ seeded RNG ใน state ทำให้ server replay และตรวจโกงได้
- **Server authoritative** client ส่งแค่คำสั่ง server รัน engine แล้วส่งกลับเฉพาะส่วนที่ผู้เล่นคนนั้นเห็นได้ (`viewFor`)
- **ตัวเลขสมดุลอยู่ที่เดียว** ปรับได้ใน `packages/engine/src/data.ts` (`RULES`, `COSTS`, `SEASONS`)
- **สีอยู่ที่เดียว** `apps/web/src/theme.ts` เป็นต้นทางทั้งของ CSS variables และสีที่ PixiJS ใช้วาดแผนที่
