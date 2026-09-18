# API (เฟส 3)

Base URL ตอนพัฒนา: `http://localhost:8787` (ตั้งได้ที่ `VITE_API_URL` ฝั่ง web)

## หลักการ

- **server เป็นผู้ตัดสิน** client ส่งแค่คำสั่ง server รัน `applyAction` แล้วส่งกลับเฉพาะ `viewFor`
  ของผู้เล่นคนนั้น (คลังของผู้เล่นอื่นถูกซ่อน, `rng` เป็น 0, event ส่วนตัวถูกกรองออก)
- **ทุกคำสั่งมี `expectedVersion`** — version ของเกมเพิ่มทีละ 1 ทุกคำสั่งที่ถูกใช้จริง
  ถ้าไม่ตรงกับของ server จะได้ `409` พร้อม view ล่าสุดมาให้ reconcile
- **ทุกคำสั่งมี `idempotencyKey`** — ส่งซ้ำด้วย key เดิมได้ผลลัพธ์เดิม ไม่ถูกใช้สองครั้ง (จำไว้ 10 นาที)
- **error รูปแบบเดียวกันทุกที่** `{ "error": "CODE", "message": "ข้อความไทย", "details": { ... } }`

## Authentication

เฟส 3 ยังไม่มีบัญชีผู้ใช้ `POST /games` จะออก **player token** ให้ทีละที่นั่ง (ดู
[ADR-0003](adr/0003-player-token-and-optimistic-updates.md)) ส่ง token มากับคำขอได้สามทาง

| ที่    | ตัวอย่าง                                                               |
| ------ | ---------------------------------------------------------------------- |
| header | `Authorization: Bearer <token>`                                        |
| header | `x-player-token: <token>`                                              |
| query  | `?token=<token>` (ใช้กับ WebSocket เพราะเบราว์เซอร์ตั้ง header ไม่ได้) |

เฟส 4 จะเปลี่ยนเป็น Supabase JWT โดย endpoint และ error ยังเหมือนเดิม

## Endpoints

### `GET /health`

```json
{ "ok": true, "engine": "0.1.0", "store": "redis", "time": "2026-01-01T00:00:00.000Z" }
```

### `GET /readyz`

ping store จริง คืน `503 { "error": "STORE_UNAVAILABLE" }` ถ้าต่อ Redis ไม่ได้

### `POST /games`

```jsonc
// request — ทุกฟิลด์ไม่บังคับ
{ "seed": 12345, "maxTurn": 30, "players": [{ "name": "อาณาจักรนที" }, { "name": "สหายเหนือ" }] }
```

`players` ได้ 1–4 คน รับที่นั่งตามลำดับ `center, north, east, south` ที่นั่งที่เหลือเป็น AI
faction id คือ `p1..p4`

```jsonc
// 201
{
  "gameId": "uuid",
  "version": 0,
  "seq": 0,
  "players": [{ "factionId": "p1", "seat": "center", "name": "อาณาจักรนที", "token": "…" }],
  "view": { "schemaVersion": 1, "turn": 1, "…": "GameState ที่ p1 เห็นได้" },
}
```

token แสดงครั้งเดียวตอนนี้ server เก็บแต่ sha256

### `GET /games/:id`

```jsonc
// 200
{ "gameId": "uuid", "version": 3, "seq": 3, "factionId": "p1", "view": { "…": "…" } }
```

### `POST /games/:id/actions`

```jsonc
// request
{
  "action": { "type": "move", "armyId": "a1", "c": 5, "r": 6 },
  "expectedVersion": 3,
  "idempotencyKey": "p1-3-8f2c1ab0",
}
```

`action` คือคำสั่ง 14 แบบเดียวกับ `Action` ใน engine (`move`, `attack`, `camp`, `found`, `build`,
`recruit`, `tribute`, `festival`, `annex`, `declareWar`, `offerPeace`, `envoy`, `answerDecision`, `endTurn`)

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
GAME=$(curl -s -X POST localhost:8787/games -H 'content-type: application/json' -d '{"seed":42}')
ID=$(echo "$GAME" | node -p 'JSON.parse(require("fs").readFileSync(0)).gameId')
TOKEN=$(echo "$GAME" | node -p 'JSON.parse(require("fs").readFileSync(0)).players[0].token')
ARMY=$(echo "$GAME" | node -p 'JSON.parse(require("fs").readFileSync(0)).view.armies.find(a=>a.owner==="p1").id')

curl -s -X POST "localhost:8787/games/$ID/actions" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"action\":{\"type\":\"camp\",\"armyId\":\"$ARMY\"},\"expectedVersion\":0,\"idempotencyKey\":\"demo-0001\"}"
```
