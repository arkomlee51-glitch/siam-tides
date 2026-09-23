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

## ลำดับการประมวลผลคำสั่ง (เฟส 4 — ทำแล้ว)

```
client ──POST /games/:id/actions { action, expectedVersion, idempotencyKey }──▶ server
server: ตรวจ Supabase JWT (JWKS หรือ HS256 secret, ดู ADR-0004) → rate limit
        → acquire lock game:{id}:lock (SET NX PX, ปล่อยด้วย compare-and-del)
        → idem:{id}:{key} มีอยู่แล้ว = คืนผลเดิมทันที
        → load state: Redis ก่อน ถ้าไม่มี (TTL หมดอายุ/instance ใหม่) โหลดจาก Supabase
          snapshot ล่าสุด + replay game_actions ที่เหลือผ่าน applyAction เดิม แล้วอุ่น Redis กลับ
        → seasonDeadline เลยมาแล้วหรือยัง (เฟส 5 — ห้องตั้ง seasonTimerSeconds ไว้)? บังคับ endTurn แทน
          คนที่ยังไม่พร้อมให้ก่อน (applyAction เดิมทุกประการ, ดู ADR-0006) — GET และ ws sync ก็เช็คจุดนี้เหมือนกัน
        → version ตรงไหม? ไม่ตรง = 409 พร้อม view ล่าสุด
        → applyAction → ok? insert game_actions (Supabase, รอผลจริงก่อนถือว่าคำสั่งสำเร็จ)
          → เขียน Redis (version+1) + จำผลไว้ที่ idem key
          → ขึ้นฤดูใหม่ = insert game_snapshots (fire-and-forget); เกมจบ = update games.status (fire-and-forget)
        → publish game:{id}:events → ทุก instance ส่ง viewFor ให้ผู้เล่นของตัวเองผ่าน WebSocket
        → release lock
```

รายละเอียด endpoint, เฟรม WebSocket และ error code อยู่ใน [API.md](API.md)
ส่วนเหตุผลของ player token (เฟส 3) และ Supabase JWT + event sourcing (เฟส 4 ที่ใช้อยู่ตอนนี้) อยู่ใน
[ADR-0003](adr/0003-player-token-and-optimistic-updates.md) และ
[ADR-0004](adr/0004-supabase-jwt-auth-and-event-sourcing.md)

## หน้าที่ของ Supabase และ Redis

| เรื่อง                | Supabase                                 | Redis                              |
| --------------------- | ---------------------------------------- | ---------------------------------- |
| ผู้ใช้/สิทธิ์         | Auth (anonymous + email), JWT, RLS       | —                                  |
| state เกมที่กำลังเล่น | snapshot ต้นฤดู                          | state ล่าสุด (TTL หลังไม่มีคนเล่น) |
| ประวัติคำสั่ง         | `game_actions` (ถาวร)                    | —                                  |
| cold-start recovery   | snapshot ล่าสุด + replay action ที่เหลือ | —                                  |
| กันชนกัน              | —                                        | lock ต่อเกม, idempotency key       |
| realtime              | —                                        | pub/sub ข้าม instance              |
| ห้องรอ/รหัสเชิญ       | `games.status = 'lobby'` (เฟส 5)         | รหัสเชิญ (TTL, เฟส 5)              |
| rate limit            | —                                        | counter ต่อผู้ใช้                  |

## Data model (เฟส 4 — ตามที่สร้างจริงใน `supabase/migrations/20260918000000_init_schema.sql`)

```sql
profiles        (id uuid pk references auth.users, display_name text, created_at timestamptz)
                 -- สร้างอัตโนมัติด้วย trigger handle_new_user() ตอน auth.users insert ใหม่
games           (id uuid pk, status text check (status in ('lobby','active','finished')),
                 seed bigint, engine_version text, max_turn int, created_by uuid, created_at, finished_at)
game_players    (game_id uuid, user_id uuid null, faction_id text, seat text, name text, ending text, joined_at,
                 primary key (game_id, faction_id),
                 unique index (game_id, user_id) where user_id is not null)
game_snapshots  (game_id uuid, turn int, version int, state jsonb, primary key (game_id, turn))
game_actions    (id bigint identity pk, game_id uuid, seq int, user_id uuid, faction_id text,
                 turn int, action jsonb, created_at, unique (game_id, seq))
```

RLS เปิดทุกตาราง มีเฉพาะ policy อ่าน (`*_select_participant`, ผ่าน security-definer function
`is_game_participant`) — เขียนได้เฉพาะ service-role key ของ server เท่านั้น (bypass RLS โดยตรง จึงไม่มี
write policy เลย) รายละเอียดและเหตุผลอยู่ใน [ADR-0004](adr/0004-supabase-jwt-auth-and-event-sourcing.md)

## Redis keys (เฟส 3–5 — ใช้อยู่)

```
game:{id}:state      JSON ของ GameState + version
game:{id}:lock       SET NX PX 2000
game:{id}:events     pub/sub channel
idem:{id}:{key}      ผลลัพธ์ของคำสั่ง (TTL 10 นาที)
lobby:{code}         JSON ของ LobbyRecord — host, seats, startedGameId (TTL LOBBY_TTL_SECONDS, ค่าเริ่มต้น 1 ชั่วโมง)
lobby:{code}:lock    SET NX PX — กัน join/leave/start ชนกัน (เฟส 5, ดู ADR-0005)
rl:{key}             rate limit counter (create:{ip}, create-lobby:{ip}, join-lobby:{ip}, action:{gameId}:{factionId})
```

## สิ่งที่ต้องกลับมาทบทวน

- ถ้าจำนวนเกมพร้อมกันสูง อาจต้องย้ายการคำนวณฤดูไป worker แยก
- `structuredClone` ทั้ง state ต่อคำสั่งพอสำหรับตอนนี้ (state เล็ก) ถ้าแผนที่ใหญ่ขึ้นมากค่อยพิจารณา immer/structural sharing
- ข้อความ event เป็นภาษาไทยใน engine ตอนนี้ ถ้าจะรองรับหลายภาษาต้องเปลี่ยนเป็น message key + params
