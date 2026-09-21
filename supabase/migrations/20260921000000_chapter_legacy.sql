-- เฟส 6: ระบบ Legacy ข้ามบท (chapter_id บน games + player_legacy)
-- ดู docs/adr/0007-chapter-content-schema-and-legacy.md
--
-- ยังไม่มี route/GameService ใดเขียนหรืออ่านตารางนี้จริง — คำนวณ bonus ทำได้แล้วในเอนจิน
-- (packages/engine/src/content/legacy.ts: computeLegacyBonuses/mergeLegacyBonuses/
-- applyLegacyBonuses ล้วนเป็น pure function) แต่การต่อเข้ากับ "จบเกมบทไหน → เขียนแถวนี้"
-- และ "เริ่มเกมบทไหน → อ่านแถวเหล่านี้มารวม" เป็นงาน product flow ที่ยังไม่ได้ออกแบบ
-- (เช่น ผู้เล่นกลุ่มเดิมต้องเล่นบทถัดไปด้วยกันไหม ถ้าองค์ประกอบกลุ่มเปลี่ยนจะทำยังไง) —
-- migration นี้แค่เตรียมที่เก็บไว้ก่อน ไม่ได้แปลว่าฟีเจอร์นี้ใช้งานได้จริงแล้ว

-- games ไม่มีแนวคิด "บท" มาก่อนเลย (เกมที่มีอยู่ทั้งหมดคือบทเดียวที่ชิปวันนี้) — คอลัมน์นี้จึง nullable
-- และ null หมายถึง "บทเดียวที่ชิปวันนี้" ไม่ใช่ error
alter table public.games
  add column chapter_id text;

comment on column public.games.chapter_id is
  'อ้างอิง ChapterDefinition.manifest.id (packages/engine/src/content/schema.ts) — null = บทเดียวที่ชิปก่อนเฟส 6';

-- ---------- player_legacy ----------

create table public.player_legacy (
  user_id uuid not null references auth.users (id) on delete cascade,
  chapter_id text not null,
  -- LegacyBonus[] จาก packages/engine/src/content/legacy.ts (category, amount, sourceChapterId, note)
  bonuses jsonb not null,
  -- เกมที่คำนวณ bonus นี้มา — เก็บไว้เผื่อ debug ว่าทำไมได้ bonus เท่านี้ ไม่ใช่ FK ที่ต้องมีเสมอ
  source_game_id uuid references public.games (id) on delete set null,
  computed_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

comment on table public.player_legacy is
  'Legacy bonus ล่าสุดของผู้เล่นต่อบทที่จบแล้ว 1 แถวต่อ (user_id, chapter_id) — เล่นบทเดิมซ้ำแล้วจบใหม่คือ
   upsert ทับแถวเดิม (ใช้ผลรอบล่าสุด ไม่ใช่ผลที่ดีที่สุดที่เคยทำได้ — เป็นทางเลือกที่ตั้งใจให้ง่ายไว้ก่อน
   ดู ADR-0007 Addendum)';

alter table public.player_legacy enable row level security;

create policy player_legacy_select_own on public.player_legacy
  for select using (user_id = auth.uid());
