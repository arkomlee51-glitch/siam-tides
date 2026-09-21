# API (เฟส 4 + เฟส 5: ห้องรอ, การทูตมนุษย์-มนุษย์, จำกัดเวลาต่อฤดู)

Base URL ตอนพัฒนา: `http://localhost:8787` (ตั้งได้ที่ `VITE_API_URL` ฝั่ง web)

## หลักการ

- **server เป็นผู้ตัดสิน** client ส่งแค่คำสั่ง server รัน `applyAction` แล้วส่งกลับเฉพาะ `viewFor`
  ของผู้เล่นคนนั้น (คลังของผู้เล่นอื่นถูกซ่อน, `rng` เป็น 0, event ส่วนตัวถูกกรองออก)
- **ทุกคำสั่งมี `expectedVersion`** — version ของเกมเพิ่มทีละ 1 ทุกคำสั่งที่ถูกใช้จริง
  ถ้าไม่ตรงกับของ server จะได้ `409` พร้อม view ล่าสุดมาให้ reconcile
- **ทุกคำสั่งมี `idempotencyKey`** — ส่งซ้ำด้วย key เดิมได้ผลลัพธ์เดิม ไม่ถูกใช้สองครั้ง (จำไว้ 10 นาที)
- **error รูปแบบเดียวกันทุกที่** `{ "error": "CODE", "message": "ข้อความไทย", "details": { ... } }`

## Authentication

เฟส 4 เปลี่ยนจาก player token ชั่วคราว (ADR-0003) มาเป็น **Supabase JWT** ทุก request (ดู
[ADR-0004](adr/0004-supabase-jwt-auth-and-event-sourcing.md)) ฝั่ง client เข้าเกมได้ทันทีแบบ anonymous
sign-in (ไม่ต้องสมัครสมาชิกก่อน) แล้วค่อยผูกอีเมลทีหลังก็ได้ — ส่ง access token มากับคำขอได้สามทาง
(รูปแบบเดิมจากเฟส 3 ทุกประการ endpoint และ error ไม่เปลี่ยน)

| ที่    | ตัวอย่าง                                                               |
| ------ | ---------------------------------------------------------------------- |
| header | `Authorization: Bearer <access_token>`                                 |
| header | `x-player-token: <access_token>`                                       |
| query  | `?token=<access_token>` (ใช้กับ WebSocket เพราะเบราว์เซอร์ตั้ง header ไม่ได้) |

server ตรวจ JWT ด้วย JWKS ของ `SUPABASE_URL` เป็นค่าเริ่มต้น (asymmetric, ไม่ต้องมี secret ฝั่ง server)
หรือ `SUPABASE_JWT_SECRET` (HS256) สำหรับโปรเจกต์เก่า — ปฏิเสธด้วย `401 UNAUTHORIZED` ถ้า token หมดอายุ/
เซ็นผิด/ไม่มี `sub` claim

## Endpoints

### `GET /health`

```json
{ "ok": true, "engine": "0.1.0", "store": "redis", "time": "2026-01-01T00:00:00.000Z" }
```

### `GET /readyz`

ping store จริง คืน `503 { "error": "STORE_UNAVAILABLE" }` ถ้าต่อ Redis ไม่ได้

### `POST /games`

ต้องมี `Authorization` (Supabase JWT) มาด้วยเสมอ ผู้สร้าง (จาก `sub` ของ JWT) ได้ที่นั่งมนุษย์เดียวคือ `p1`
ที่นั่งที่เหลือเป็น AI ทั้งหมด — เชิญคนอื่นมาเล่นที่นั่งเดียวกันยกไปเฟส 5 (ห้องรอ/รหัสเชิญ)

```jsonc
// request — ทุกฟิลด์ไม่บังคับ
{ "seed": 12345, "maxTurn": 30, "name": "อาณาจักรนที" }
```

```jsonc
// 201
{
  "gameId": "uuid",
  "version": 0,
  "seq": 0,
  "factionId": "p1",
  "view": { "schemaVersion": 1, "turn": 1, "…": "GameState ที่ p1 เห็นได้" },
}
```

เกมถูกเขียนลง Supabase (`games` + `game_players`) ก่อนเสมอ ถึงจะถือว่าสร้างสำเร็จ (ดู ADR-0004)

### `GET /games/:id`

```jsonc
// 200
{
  "gameId": "uuid",
  "version": 3,
  "seq": 3,
  "factionId": "p1",
  "view": { "…": "…" },
  // null ถ้าห้องที่สร้างเกมนี้ไม่ได้ตั้งจำกัดเวลาต่อฤดู (ดูหัวข้อ "จำกัดเวลาต่อฤดู" ด้านล่าง)
  "seasonTimerSeconds": 600,
  "seasonDeadline": "2026-09-21T10:10:00.000Z",
}
```

`GET`/`POST .../actions`/WebSocket `sync` ทุกตัวจะ **ตรวจและบังคับ endTurn แทนอัตโนมัติ** ถ้า
`seasonDeadline` เลยมาแล้วแต่ยังมีมนุษย์ไม่ ready ก่อนตอบกลับเสมอ (ดูหัวข้อ "จำกัดเวลาต่อฤดู")

### `POST /games/:id/actions`

```jsonc
// request
{
  "action": { "type": "move", "armyId": "a1", "c": 5, "r": 6 },
  "expectedVersion": 3,
  "idempotencyKey": "p1-3-8f2c1ab0",
}
```

`action` คือคำสั่ง 16 แบบเดียวกับ `Action` ใน engine (`move`, `attack`, `camp`, `found`, `build`,
`recruit`, `tribute`, `festival`, `annex`, `declareWar`, `offerPeace`, `proposePeace`, `answerProposal`,
`envoy`, `answerDecision`, `endTurn`) — `proposePeace`/`answerProposal` ใหม่ในเฟส 5 ดูหัวข้อ
"การทูตมนุษย์-มนุษย์" ด้านล่าง

```jsonc
// 200
{
  "gameId": "uuid",
  "version": 4,
  "seq": 4,
  "factionId": "p1",
  "view": { "…": "…" },
  "events": [{ "turn": 3, "kind": "army", "tone": "good", "text": "ตั้งค่ายพักพล…" }],
  "replayed": false,
}
```

`replayed: true` (และ header `x-idempotent-replay: true`) = เป็นการส่งซ้ำ server ไม่ได้ใช้คำสั่งใหม่

### `GET /games/:id/ws?token=…`

WebSocket เฟรมเป็น JSON บรรทัดเดียว

| ทิศทาง          | เฟรม                                                        | ความหมาย                                                    |
| --------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| server → client | `{ "type": "sync", "version", "seq", "factionId", "view" }` | สถานะปัจจุบัน ส่งตอนต่อสำเร็จและตอบ `resync`                |
| server → client | `{ "type": "update", "version", "seq", "view", "events" }`  | มีคำสั่งถูกใช้ (ของตัวเอง ของผู้เล่นอื่น หรือผลการคำนวณฤดู) |
| server → client | `{ "type": "error", "error", "message" }`                   | ต่อไม่ผ่าน แล้วปิดสาย                                       |
| client → server | `{ "type": "ping" }`                                        | ได้ `{ "type": "pong" }`                                    |
| client → server | `{ "type": "resync" }`                                      | ขอ `sync` ใหม่หลังสายหลุด                                   |

server subscribe ให้ก่อนแล้วจึงส่ง `sync` จึงไม่มีช่องที่ update จะหลุดหาย
client ทิ้งเฟรมที่ `version` ไม่สูงกว่าที่ถืออยู่

## เฟส 5: ห้องรอ + รหัสเชิญ

สร้างเกมหลายคนต้องผ่านห้องรอก่อนเสมอ (`POST /games` ยังสร้างได้แค่ที่นั่งมนุษย์เดียวเหมือนเดิม) — ดู
[ADR-0005](adr/0005-lobby-and-invite-codes.md) ทุก endpoint ต้องมี `Authorization` เหมือนกับ `/games`

### `POST /lobbies`

```jsonc
// request — ทุกฟิลด์ไม่บังคับ
// seasonTimerSeconds: 30–604800 (7 วัน) — ไม่ส่ง = ไม่จำกัดเวลาต่อฤดู
{ "seed": 12345, "maxTurn": 30, "name": "อาณาจักรนที", "seasonTimerSeconds": 600 }
```

```jsonc
// 201 — ผู้สร้างได้ที่นั่งแรกอัตโนมัติ (จะกลายเป็น p1 เสมอตอนเริ่มเกม)
{
  "code": "K7M3XQ",
  "hostUserId": "uuid ของผู้สร้าง",
  "seed": 12345,
  "maxTurn": 30,
  "seats": [{ "userId": "…", "name": "อาณาจักรนที" }],
  "startedGameId": null,
  "seasonTimerSeconds": 600,
}
```

รหัสห้อง 6 หลัก ตัวพิมพ์ใหญ่ + เลข ตัดตัวที่อ่านสับสน (`0/O`, `1/I/L`) ออกแล้ว

### `GET /lobbies/:code`

คืนสถานะห้องปัจจุบัน (รูปแบบเดียวกับตอนสร้าง) — client โพลทุก ~2 วินาทีเพื่อดูสมาชิกใหม่และ
`startedGameId`; ห้องไม่มี/หมดอายุแล้วได้ `404 LOBBY_NOT_FOUND`

### `POST /lobbies/:code/join`

```jsonc
// request — ไม่บังคับ
{ "name": "เพื่อนผู้เล่น" }
```

เข้าร่วมที่นั่งถัดไป (สูงสุด 4 คน) เรียกซ้ำด้วย user เดิมได้ผลเดิม (idempotent, แก้แค่ชื่อถ้าส่งมาใหม่)
ห้องเต็มแล้วได้ `422 LOBBY_FULL`, ห้องเริ่มไปแล้วได้ `409 LOBBY_STARTED` (พร้อม `details.gameId`)

### `POST /lobbies/:code/leave`

`204` เสมอ (no-op ถ้าไม่ใช่สมาชิกอยู่แล้ว) — **host ออก = ยกเลิกห้องทั้งหมด** สมาชิกที่เหลือจะเจอ
`404` ตอน poll ครั้งถัดไป

### `POST /lobbies/:code/start`

เฉพาะ host เรียกได้ (`403 FORBIDDEN` ถ้าไม่ใช่) — สร้างเกมจริงจากที่นั่งทั้งหมดตอนนั้น (เขียน Supabase +
Redis เหมือน `POST /games`) แล้วคืน `Snapshot` ของ host (`factionId: "p1"` เสมอ) ที่นั่งอื่นต้องไป
`GET /games/:id` เองด้วย token ของตัวเองเพื่อได้ `factionId`/`view` ของตน ห้องไม่ถูกลบทันที
(`startedGameId` ถูกตั้งไว้ให้คนที่ยัง poll เจอ แล้วปล่อยให้หมดอายุไปเองตาม TTL) เรียกซ้ำได้
`409 LOBBY_STARTED`

## การทูตมนุษย์-มนุษย์ (เฟส 5)

`tribute` / `festival` / `annex` / `offerPeace` (แบบเดิม จ่ายแล้วมีโอกาสสำเร็จ) ยังใช้ได้แค่กับ AI เท่านั้น
เหมือนก่อนเฟส 5 — สงบศึกกับมนุษย์ด้วยกันต้องให้อีกฝ่าย**ตอบรับเอง** ผ่านคำสั่งใหม่สองตัว (ไม่มีโอกาสสุ่ม,
ไม่มีค่าใช้จ่าย, ดู [ADR-0006](adr/0006-human-diplomacy-and-season-timer.md)):

- `proposePeace` — `{ "type": "proposePeace", "target": "p2" }` ต้องอยู่ในภาวะสงครามกับเป้าหมายก่อน
  เสนอซ้ำทับของเดิมได้ (upsert) ไม่ทำให้ turn ของผู้เสนอถูกบล็อก
- `answerProposal` — `{ "type": "answerProposal", "proposalId": "…", "accept": true }` เฉพาะผู้ถูกเสนอ
  (`to`) ตอบได้เท่านั้น — `accept: true` = สงบศึกทันที (`relation.war = false`), `accept: false` = ปฏิเสธ
  ไม่มีผลอะไรกับความสัมพันธ์

`GameState.proposals` (ผ่าน `view` ที่ได้จาก `viewFor`) กรองให้เห็นเฉพาะข้อเสนอที่ตัวเองเป็น `from` หรือ
`to` เท่านั้น — คนที่สามมองไม่เห็นข้อเสนอระหว่างอีกสองคน

## จำกัดเวลาต่อฤดู (เฟส 5)

ตั้งได้ตอนสร้างห้องรอเท่านั้น (`POST /lobbies` → `seasonTimerSeconds`) ไม่มีตัวจับเวลา = ไม่บังคับ ถ้ามี
server จะ**ตรวจตอน request ถัดไปเข้ามา** (ไม่มี background job แยก) — `GET /games/:id`,
`POST /games/:id/actions`, และ WebSocket `sync` ทุกตัวเช็คก่อนตอบกลับเสมอ ว่า `seasonDeadline` เลยมาหรือยัง
ถ้าเลยแล้วและยังมีมนุษย์ที่ยังไม่ `endTurn` server จะยิง `endTurn` แทนให้ทุกคนที่ค้างอยู่ (ผ่าน `applyAction`
ตัวเดียวกับคำสั่งปกติ บันทึกลง `game_actions` เหมือนกันทุกประการ — cold-start replay จึงสร้างผลลัพธ์เดิมซ้ำได้)
แล้วตั้ง `seasonDeadline` ใหม่ให้ฤดูถัดไป จบเกม (`ended: true`) แล้ว `seasonDeadline` กลับเป็น `null` เสมอ

**ข้อจำกัดที่รู้อยู่**: `seasonTimerSeconds` เก็บอยู่ที่ Redis/memory record เท่านั้น ยังไม่ถูกเขียนลง
Supabase — ถ้าเกิด cold-start replay (Redis หมดอายุ/instance ใหม่ ดู ADR-0004) เกมนั้นจะกลับไปเป็น
"ไม่จำกัดเวลา" แทนที่จะจำค่าเดิมไว้ (ปลอดภัยกว่าเดาเวลาใหม่ผิด ๆ แต่ยังไม่ใช่พฤติกรรมที่สมบูรณ์)

## Error codes

| HTTP | error                 | เมื่อไหร่                                                                                  |
| ---- | --------------------- | ------------------------------------------------------------------------------------------ |
| 400  | `BAD_REQUEST`         | body/params ไม่ผ่าน schema                                                                 |
| 401  | `UNAUTHORIZED`        | ไม่ได้ส่ง token                                                                            |
| 403  | `FORBIDDEN`           | token ไม่ใช่ของเกมนี้                                                                      |
| 404  | `NOT_FOUND`           | ไม่มีเกมนั้น หรือไม่มีเส้นทางนั้น                                                          |
| 409  | `VERSION_CONFLICT`    | `expectedVersion` ไม่ตรง — `details.version`, `details.seq`, `details.view` มีของล่าสุดให้ |
| 422  | error code ของ engine | engine ปฏิเสธคำสั่ง (`INSUFFICIENT_RESOURCES`, `UNREACHABLE`, `NOT_AT_WAR`, …)             |
| 429  | `RATE_LIMITED`        | ส่งถี่เกิน `details.resetSeconds` บอกเวลาที่ต้องรอ                                         |
| 503  | `LOCK_TIMEOUT`        | รอ lock ของเกมนานเกิน `LOCK_WAIT_MS`                                                       |
| 503  | `STORE_UNAVAILABLE`   | `/readyz` ต่อ store ไม่ได้                                                                 |
| 404  | `LOBBY_NOT_FOUND`     | ไม่มีห้องรอรหัสนี้ หรือหมดอายุแล้ว                                                          |
| 422  | `LOBBY_FULL`          | ห้องรอเต็มแล้ว (4 คน)                                                                       |
| 409  | `LOBBY_STARTED`       | ห้องรอนี้เริ่มเกมไปแล้ว — `details.gameId` มี id ของเกมให้ไปต่อ                            |

## ลำดับการประมวลผลคำสั่ง

```
POST /games/:id/actions
  → rate limit (rl:action:{gameId}:{factionId})
  → lock game:{id}:lock (SET NX PX, ปล่อยด้วย compare-and-del)
      → idem:{id}:{key} มีอยู่แล้ว? คืนผลเดิม
      → โหลด game:{id}:state
      → version ตรงไหม? ไม่ตรง = 409
      → applyAction → ปฏิเสธ = 422 (จำผลไว้ที่ idem key)
      → เขียน state (version+1), จำผลไว้ที่ idem key
      → publish game:{id}:events → ทุก instance ส่ง viewFor ให้ผู้เล่นของตัวเองทาง WebSocket
  → ปล่อย lock
```

## Redis keys

```
game:{id}:state      GameRecord (version, seq, seats, state) — TTL GAME_TTL_SECONDS
game:{id}:lock       SET NX PX LOCK_TTL_MS
game:{id}:events     pub/sub channel
idem:{id}:{key}      ผลลัพธ์ของคำสั่ง — TTL IDEMPOTENCY_TTL_SECONDS
rl:{key}             ตัวนับ rate limit — TTL RATE_LIMIT_WINDOW_SECONDS
```

## ตัวอย่างด้วย curl

```bash
# TOKEN = Supabase access token (เช่น สมัคร anonymous ผ่าน Supabase client แล้วอ่าน session.access_token)
GAME=$(curl -s -X POST localhost:8787/games \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"seed":42}')
ID=$(echo "$GAME" | node -p 'JSON.parse(require("fs").readFileSync(0)).gameId')
ARMY=$(echo "$GAME" | node -p 'JSON.parse(require("fs").readFileSync(0)).view.armies.find(a=>a.owner==="p1").id')

curl -s -X POST "localhost:8787/games/$ID/actions" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"action\":{\"type\":\"camp\",\"armyId\":\"$ARMY\"},\"expectedVersion\":0,\"idempotencyKey\":\"demo-0001\"}"
```
