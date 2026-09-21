# Supabase

Migration และ config ของโปรเจกต์นี้ (เฟส 4 — ดู [ADR-0004](../docs/adr/0004-supabase-jwt-auth-and-event-sourcing.md))

- `config.toml` — ตั้งค่า local dev (`npx supabase init` เป็นตัวสร้าง), เปิด `enable_anonymous_sign_ins`
  และ `enable_manual_linking` ไว้แล้วเพราะ auth flow ของเกมใช้สองอย่างนี้
- `migrations/20260918000000_init_schema.sql` — ตาราง `profiles`, `games`, `game_players`,
  `game_snapshots`, `game_actions` พร้อม RLS (อ่านได้เฉพาะผู้เล่นในเกมนั้น, เขียนได้เฉพาะ service role)
  ดูโครงสร้างเต็มใน [ARCHITECTURE.md](../docs/ARCHITECTURE.md#data-model-เฟส-4--ตามที่สร้างจริงใน-supabasemigrations20260918000000_init_schemasql)
- `seed.sql` — ว่างไว้ก่อน (placeholder)

## รันกับโปรเจกต์ Supabase จริง

1. สร้างโปรเจกต์ที่ [supabase.com](https://supabase.com) แล้วเอา Project URL + service role key +
   anon/publishable key จาก Project Settings > API มาใส่ `.env` (ดู `.env.example` ที่ root)
2. push migration เข้าโปรเจกต์: `npx supabase link --project-ref <ref>` แล้ว `npx supabase db push`
   (หรือรัน `migrations/*.sql` ผ่าน SQL editor ของ dashboard ตรง ๆ)
3. ถ้ามี Docker ในเครื่อง จะรัน `npx supabase start` + `npx supabase db reset` เพื่อทดสอบ local stack
   เต็มรูปแบบได้ — สภาพแวดล้อมที่พัฒนา ADR-0004 นี้ไม่มี Docker จึงตรวจ migration/RLS ด้วย Postgres
   local เปล่า ๆ (จำลอง schema `auth`) แทน ยังไม่เคยรันกับ Supabase จริง ควรรันซ้ำอีกครั้งก่อนขึ้น production
