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

## Server (`apps/server`)

- `config` — อ่าน env ด้วย zod, `store` เลือก redis/memory (memory เป็นค่าเริ่มต้นตอน test)
- `store/` — interface เดียวสองตัว (`redis.ts`, `memory.ts`): state, lock, idempotency, rate limit, pub/sub
- `game/service.ts` — ที่เดียวที่เรียก `applyAction` และตัดสิน version/idempotency
- `routes/games.ts` — REST, `routes/ws.ts` — WebSocket, `schemas.ts` — zod (มี type check ว่าตรงกับ `Action`)
- `errors.ts` — `AppError` และ error body รูปแบบเดียว `{ error, message, details? }`

## ลำดับการประมวลผลคำสั่ง (เฟส 3 — ทำแล้ว)

```
client ──POST /games/:id/actions { action, expectedVersion, idempotencyKey }──▶ server
server: ตรวจ player token (เฟส 4 = Supabase JWT) → rate limit
        → acquire lock game:{id}:lock (SET NX PX, ปล่อยด้วย compare-and-del)
        → idem:{id}:{key} มีอยู่แล้ว = คืนผลเดิมทันที
        → load state (Redis; เฟส 4 ถ้าไม่มีจะโหลดจาก Postgres snapshot + replay)
        → version ตรงไหม? ไม่ตรง = 409 พร้อม view ล่าสุด
        → applyAction → ok? เขียน Redis (version+1) + จำผลไว้ที่ idem key
          (เฟส 4 เพิ่ม insert game_actions + snapshot ถ้าขึ้นฤดูใหม่)
        → publish game:{id}:events → ทุก instance ส่ง viewFor ให้ผู้เล่นของตัวเองผ่าน WebSocket
        → release lock
```

รายละเอียด endpoint, เฟรม WebSocket และ error code อยู่ใน [API.md](API.md)
ส่วนเหตุผลของ player token และ optimistic update อยู่ใน [ADR-0003](adr/0003-player-token-and-optimistic-updates.md)

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

## Redis keys (เฟส 3 — ใช้อยู่)

```
game:{id}:state      JSON ของ GameState + version
game:{id}:lock       SET NX PX 2000
game:{id}:events     pub/sub channel
idem:{id}:{key}      ผลลัพธ์ของคำสั่ง (TTL 10 นาที)
lobby:{code}         game id (TTL 1 ชั่วโมง) — เฟส 5
rl:{key}             rate limit counter (create:{ip}, action:{gameId}:{factionId})
```

## สิ่งที่ต้องกลับมาทบทวน

- ถ้าจำนวนเกมพร้อมกันสูง อาจต้องย้ายการคำนวณฤดูไป worker แยก
- `structuredClone` ทั้ง state ต่อคำสั่งพอสำหรับตอนนี้ (state เล็ก) ถ้าแผนที่ใหญ่ขึ้นมากค่อยพิจารณา immer/structural sharing
- ข้อความ event เป็นภาษาไทยใน engine ตอนนี้ ถ้าจะรองรับหลายภาษาต้องเปลี่ยนเป็น message key + params
