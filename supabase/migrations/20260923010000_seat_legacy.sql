-- ต่อระบบ Legacy ข้ามบทเข้ากับ flow จริง (ADR-0007 Addendum 9)
--
-- player_legacy (migration 20260921000000) เก็บ Legacy ที่ผู้เล่นได้ตอนจบบท — คอลัมน์นี้เก็บว่าตอน "เริ่ม"
-- เกมนี้ ที่นั่งนี้ได้ Legacy รวมเท่าไรไปใช้จริง (ผลของ mergeLegacyBonuses เช่น {"military": 0.1}) —
-- จำเป็นสำหรับ cold-start replay: replay ต้องสร้างเกมด้วย Legacy ชุดเดิมเป๊ะ ไม่ใช่อ่าน player_legacy
-- ล่าสุดใหม่ (ซึ่งอาจเปลี่ยนไปแล้วเพราะผู้เล่นจบเกมอื่นระหว่างนั้น)
--
-- null = ที่นั่งนี้ไม่มี Legacy (AI, ผู้เล่นที่ยังไม่เคยจบบทไหน, หรือเกมที่สร้างก่อน migration นี้)

alter table public.game_players
  add column legacy jsonb;

comment on column public.game_players.legacy is
  'Legacy รวมที่ที่นั่งนี้ได้ตอนเริ่มเกม (LegacyCategory → fraction) — replay ใช้ค่านี้ ไม่อ่าน player_legacy ใหม่';
