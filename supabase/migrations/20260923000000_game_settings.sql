-- เก็บค่าตั้งเกมที่ cold-start replay ต้องใช้ให้ครบ (ปิดข้อ 8 ของ ADR-0006 — ดู ADR-0007 Addendum 8)
--
-- ก่อนหน้านี้ seasonTimerSeconds อยู่แค่ใน store ร้อน (Redis/memory) — พอ Redis หมดอายุแล้ว replay จาก
-- Supabase เกมจะกลายเป็น "ไม่จำกัดเวลา" เงียบ ๆ คอลัมน์นี้ทำให้ replay จำค่าเดิมได้
--
-- เก็บแค่ "กี่วินาทีต่อฤดู" ไม่เก็บ deadline ของฤดูปัจจุบัน: ตอน replay เซิร์ฟเวอร์เริ่มนับฤดูปัจจุบันใหม่เต็ม
-- ช่วงเวลา — ผู้เล่นได้เวลาเพิ่มได้อย่างเดียว ไม่มีทางเสียเวลา (หลักเดียวกับข้อ 8 เดิม) และไม่ต้องเขียน DB
-- เพิ่มทุกครั้งที่ขึ้นฤดูใหม่

alter table public.games
  add column season_timer_seconds int
    check (season_timer_seconds is null or (season_timer_seconds > 0 and season_timer_seconds <= 604800));

comment on column public.games.season_timer_seconds is
  'วินาทีต่อฤดูที่ตั้งไว้ตอนสร้างห้อง (null = ไม่จำกัดเวลา) — replay เริ่มนับฤดูปัจจุบันใหม่เต็มช่วง';
