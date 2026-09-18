# Architecture

## ภาพรวม

```
┌───────────── apps/web (React) ─────────────┐        ┌──────── apps/server (Fastify) ────────┐
│ UI panels ── Zustand store ── PixiJS map   │        │ routes / ws ── GameService            │
│                  │                         │  cmd   │                  │                    │
│        @siam/engine (optimistic)           │ ─────▶ │        @siam/engine (authoritative)   │
│                  ▲                         │ ◀───── │                  │                    │
└──────────────────┼─────────────────────────┘  view  └──────┬───────────┼────────────────────┘
                   │                                         │           │
           Supabase Auth (JWT)                          Redis (hot)   Supabase Postgres (durable)
```

## Engine (`packages/engine`)

- ไม่มี I/O, ไม่มี DOM, ไม่มี `Math.random` — ทุกอย่าง deterministic
- `GameState` เป็น JSON ล้วน เก็บลง Redis/Postgres ได้ตรง ๆ
- `applyAction` clone state (`structuredClone`) แล้วให้ handler แก้สำเนา ถ้า error ก็ทิ้งสำเนา
- Event มีฟิลด์ `to` บอกว่าใครเห็นได้ (`null` = ทุกคน)
- โมดูล: `data` (ค่าคงที่/สมดุล) · `hex` · `rng` · `state` · `economy` · `movement` · `combat` · `ai` · `powers` · `turn` · `endings` · `actions` · `views`

## ลำดับการประมวลผลคำสั่ง (เฟส 3)

```
client ──POST /games/:id/actions { action, expectedVersion, idempotencyKey }──▶ server
server: verify JWT → Redis SET idem key NX (ซ้ำ = คืนผลเดิม)
        → acquire lock game:{id}:lock
        → load state (Redis, ถ้าไม่มีโหลดจาก Postgres snapshot + replay)
        → version ตรงไหม? ไม่ตรง = 409
        → applyAction → ok? เขียน Redis + insert game_actions (+ snapshot ถ้าขึ้นฤดูใหม่)
        → publish game:{id}:events → ส่ง viewFor ให้ผู้เล่นแต่ละคนผ่าน WebSocket
        → release lock
```

## หน้าที่ของ Supabase และ Redis

| เรื่อง                | Supabase                 | Redis                              |
| --------------------- | ------------------------ | ---------------------------------- |
| ผู้ใช้/สิทธิ์         | Auth, JWT, RLS           | —                                  |
| state เกมที่กำลังเล่น | snapshot ต้นฤดู          | state ล่าสุด (TTL หลังไม่มีคนเล่น) |
| ประวัติคำสั่ง         | `game_actions` (ถาวร)    | —                                  |
| กันชนกัน              | —                        | lock ต่อเกม, idempotency key       |
| realtime              | —                        | pub/sub ข้าม instance              |
| ห้องรอ/รหัสเชิญ       | `games.status = 'lobby'` | รหัสเชิญ (TTL)                     |
| rate limit            | —                        | counter ต่อผู้ใช้                  |

## Data model (ร่าง เฟส 4)

```sql
profiles        (id uuid pk references auth.users, display_name text, created_at timestamptz)
games           (id uuid pk, status text check (status in ('lobby','active','finished')),
                 seed bigint, engine_version text, max_turn int, created_by uuid, created_at, finished_at)
game_players    (game_id uuid, user_id uuid, faction_id text, seat text, ending text, joined_at,
                 primary key (game_id, user_id))
game_snapshots  (game_id uuid, turn int, version int, state jsonb, created_at, primary key (game_id, turn))
game_actions    (id bigserial pk, game_id uuid, seq int, user_id uuid, faction_id text,
                 turn int, action jsonb, created_at, unique (game_id, seq))
```

## Redis keys (ร่าง เฟส 3)

```
game:{id}:state      JSON ของ GameState + version
game:{id}:lock       SET NX PX 2000
game:{id}:events     pub/sub channel
idem:{id}:{key}      ผลลัพธ์ของคำสั่ง (TTL 10 นาที)
lobby:{code}         game id (TTL 1 ชั่วโมง)
rl:{userId}          rate limit counter
```

## สิ่งที่ต้องกลับมาทบทวน

- ถ้าจำนวนเกมพร้อมกันสูง อาจต้องย้ายการคำนวณฤดูไป worker แยก
- `structuredClone` ทั้ง state ต่อคำสั่งพอสำหรับตอนนี้ (state เล็ก) ถ้าแผนที่ใหญ่ขึ้นมากค่อยพิจารณา immer/structural sharing
- ข้อความ event เป็นภาษาไทยใน engine ตอนนี้ ถ้าจะรองรับหลายภาษาต้องเปลี่ยนเป็น message key + params
