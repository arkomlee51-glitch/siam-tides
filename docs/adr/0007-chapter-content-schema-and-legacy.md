# ADR-0007: Chapter content schema + ระบบ Legacy (เฟส 6 ตอนแรก)

**Status:** Accepted
**Date:** 2026-09-21

## Context

เฟส 5 (multiplayer) ถือว่าจบแล้วในส่วนที่ทำได้ในสภาพแวดล้อมพัฒนานี้ (ดู ADR-0006 กับ ROADMAP.md เฟส 5) —
เหลือแค่ยืนยัน Redis จริงข้าม instance ที่ต้องให้ลีรันเองด้วย Docker

เฟส 6 ("เนื้อหาเต็ม") ในแผนเดิมมี 6 ข้อกว้าง ๆ: เนื้อหา 6 บทแบบ data-driven, ระบบ Legacy, tech tree,
การ์ดขุนพล, Tactical View, Timeline Replay ลีเลือกให้เริ่มจาก **"ออกแบบ schema เนื้อหา + ระบบ Legacy ก่อน"**
เพราะทั้งสองอย่างเป็นฐานที่ทุกข้ออื่นต้องพึ่งพา — เขียนเนื้อหา 6 บทไปก่อนโดยไม่มี schema จะได้ของที่รื้อทิ้ง
ทำใหม่แน่ ๆ เมื่อ schema เสร็จทีหลัง

ก่อนออกแบบ อ่านโค้ดปัจจุบันทั้งหมดที่เกี่ยวกับเนื้อหา (`packages/engine/src/data.ts`, `types.ts`,
`state.ts`) พบว่าเกมที่มีอยู่ตอนนี้เป็น **บทเดียว hard-code ทั้งหมด**: `TerrainId`/`BuildingId`/`PerkId`/
`PowerId`/`EndingId` เป็น TypeScript literal union ตายตัว ไม่ใช่ data-driven เลย และ `createGame()` (ใน
`state.ts`) import ค่าคงที่จาก `data.ts` ตรง ๆ ที่ module level (`SEATS`, `RULES`, `SEASONS`, `POWER_IDS`)
— เช่นเดียวกับ `economy.ts`/`turn.ts`/`ai.ts`/`combat.ts`/`powers.ts` ซึ่งอ้างอิง `data.ts` แบบเดียวกัน
ตลอดทั้งไฟล์

## Decision

**1. แยก "chassis" (เอนจินกลไกกลาง) ออกจาก "เนื้อหาต่อบท" อย่างชัดเจนในระดับ schema ก่อน ไม่ใช่ไปแก้เอนจิน
ทันที**

กลไกที่ใช้ร่วมกันทุกบท (hex movement, ฤดูกาล, กองทัพ, เมือง, การรบ, การทูต, Chronicle) ไม่เปลี่ยน — สิ่งที่
เปลี่ยนต่อบทคือ**เนื้อหา**: แผนที่, ภูมิประเทศ, อาคาร, perk, มหาอำนาจต่างชาติ, ข้อเสนอ, ตอนจบ, ที่นั่งเริ่มต้น
ออกแบบ `ChapterDefinition` (`packages/engine/src/content/schema.ts`) ให้ตรงกับรูปร่างของ `data.ts` ทุก
export แทบทั้งหมด (คนละชื่อ field เดียวกัน) เพื่อให้การพอร์ตในอนาคตเป็นการย้ายกลไก ไม่ใช่ออกแบบใหม่

**2. Resource ID เป็นข้อยกเว้นเดียว — ตรึงไว้คงที่ ไม่ใช่ data-driven**

`CORE_RESOURCE_IDS = ['rice','man','wealth','faith','know']` เป็นค่าคงที่ระดับ chassis ไม่ใช่ข้อมูลต่อบท
เหตุผล: ระบบ Legacy (ข้อ 4) ต้องมีหน่วยกลางที่มีความหมายเหมือนกันข้ามบท ถ้าให้แต่ละบทกำหนด resource ของ
ตัวเองได้อิสระ (เช่น บทก่อนประวัติศาสตร์อาจไม่มี "เงินตรา") จะต้องมีตาราง conversion ระหว่างบท ซึ่งซับซ้อน
เกินความจำเป็นสำหรับเกมขนาดนี้ — แต่ละบทยังปรับ**ชื่อ/ไอคอน**ของ resource ได้ผ่าน `resourceLabels` (เช่น
"know" อาจแสดงเป็น "ภูมิปัญญา" ในบทก่อนประวัติศาสตร์ แต่เป็น "วิทยาการ" ในบทสมัยใหม่) — แค่ id กับความหมาย
เชิงกลไกที่ตรึงไว้

**3. Validation เป็น structural check ไม่ใช่ตัวช่วยบาลานซ์**

`validateChapterDefinition()` (schema.ts) ตรวจแค่ความถูกต้องเชิงโครงสร้าง (แถวแผนที่ยาวเท่ากัน, glyph บน
แผนที่มี terrain def รองรับ, `terrainOrder`/`endingOrder` ไม่อ้างอิง id ที่ไม่มีจริง, อาคารเริ่มต้นของที่นั่ง
มีอยู่จริง ฯลฯ) และคืนปัญหา**ทั้งหมด**ที่เจอในครั้งเดียว (ไม่ใช่แค่ข้อแรก) เพราะคนเขียนเนื้อหาบทใหม่อยากเห็น
รายการปัญหาทั้งหมดรวดเดียว ไม่ใช่ไล่แก้ทีละจุด — ไม่ตรวจสมดุลเกม (เช่น "อาคารนี้ถูกไปไหม") เพราะนั่นเป็นงาน
ของ balance simulation tooling (รายการ Phase 6 ข้ออื่นที่ยังไม่ทำ)

**4. ระบบ Legacy คำนวณจาก 6 หมวดคงที่ ผูกกับ resource/stat กลางเท่านั้น ไม่แตะ id เฉพาะบท**

`LegacyCategory` มี 6 หมวด: `infrastructure`(→rice), `prosperity`(→wealth), `culture`(→faith+stability),
`knowledge`(→know), `military`(→army str), `diplomacy`(→relation) — แต่ละหมวดคำนวณจากสถิติทั่วไปของ
faction ตอนจบบท (`computeLegacyBonuses` ใน `legacy.ts`: จำนวนเมืองที่ถือครอง, ทรัพย์สะสม, ศรัทธา/ความรู้
สะสม, จำนวนชนะศึก, จำนวนเจรจา/ยอมรับข้อเสนอสำเร็จ) แล้วแปลงเป็น bonus ผ่าน diminishing-returns curve
(`1 - e^(-raw/k)`) คูณด้วย cap ของหมวดนั้น —**ไม่มีทางเกิน cap ไม่ว่า raw input จะสูงแค่ไหน** (ทดสอบด้วยค่า
สุดขั้ว 1,000,000 ใน `content-schema.test.ts`) การจงใจไม่อ้างอิง building/perk id เฉพาะบทเลย ทำให้ bonus
จากบทไหนก็ใช้ได้กับบทถัดไปโดยไม่ต้องมีตาราง mapping ระหว่างบท — `applyLegacyBonuses()` แปลง total ที่รวม
จากหลายบทแล้ว (`mergeLegacyBonuses`, ยัง cap ซ้ำอีกชั้น) เป็นค่าปรับทั่วไปแค่ 5 อย่าง: yield multiplier ต่อ
resource, resource bonus เริ่มต้น, stability bonus, army str multiplier, relation bonus

**5. Cap ต่อหมวดต่ำโดยตั้งใจ (10–15%) เพื่อกัน snowball**

`infrastructure`/`prosperity`/`culture`/`knowledge` cap ที่ 15%, `military`/`diplomacy` cap ที่ 10% (ต่ำกว่า
เพราะพลังทหารที่สะสมข้ามบทอันตรายต่อบาลานซ์มากกว่า) — เป้าหมายคือเล่น 5 บทเก่งมากกับเล่น 2 บทเก่งมาก ต้อง
ต่างกันไม่มาก ไม่ใช่ให้ผู้เล่นที่เล่นมาไกลกว่าครองบทหลัง ๆ ได้แบบไม่มีทางแพ้

**6. พอร์ตเนื้อหาที่มีอยู่จริงเป็นบทตัวอย่าง — derive จาก `data.ts` ไม่ใช่พิมพ์ซ้ำ**

`packages/engine/src/content/chapters/early-rattanakosin.ts` สร้าง `ChapterDefinition` จาก export ของ
`data.ts` ตรง ๆ (`import { BUILDINGS, RULES, SEATS, ... } from '../../data.js'`) ไม่ใช่พิมพ์เนื้อหา ~400
บรรทัดซ้ำ — เหตุผล: (ก) พิสูจน์ว่า schema รองรับเนื้อหาจริงที่ผ่านการปรับบาลานซ์และทดสอบมาแล้วได้จริง ไม่ใช่
แค่ทฤษฎี (ข) กันไม่ให้ไฟล์นี้ค่อย ๆ เพี้ยนไปจาก `data.ts` ที่เกมจริงยังใช้อยู่ ตราบใดที่เอนจินยังไม่ถูก
rewire ให้อ่านจาก `ChapterDefinition` จริง (ข้อ 7)

**การจัดวางในบท 4 จาก 6**: เนื้อหานี้ (มหาอำนาจสองฝ่ายดึงแถบไผ่ทางการทูต เสี่ยงกลายเป็นรัฐใต้อาณัติ) ตรงกับ
ประวัติศาสตร์การทูตต้นรัตนโกสินทร์ (รัชกาลที่ 3–5 เผชิญแรงกดดันจากอังกฤษ/ฝรั่งเศส) ไม่ใช่แค่ยัดเข้าบทไหนก็ได้
— แต่**เป็นการวางตำแหน่งชั่วคราวของ Claude เอง ยังไม่ผ่านที่ปรึกษาประวัติศาสตร์**ตามที่ ROADMAP.md เฟส 6
ระบุไว้ว่าต้องมี

**7. ยังไม่ rewire เอนจินให้อ่าน `ChapterDefinition` จริง — ตั้งใจ**

`createGame`/`economy.ts`/`turn.ts`/`ai.ts`/`combat.ts`/`powers.ts` ยัง import จาก `data.ts` ตรง ๆ
เหมือนเดิมทุกไฟล์ เกมที่รันอยู่วันนี้ไม่เปลี่ยนพฤติกรรมเลยแม้แต่บรรทัดเดียว การเปลี่ยนทุกไฟล์เหล่านี้ให้รับ
`ChapterDefinition` เป็นพารามิเตอร์แทนเป็นงาน refactor ขนาดใหญ่ที่แตะเกือบทุกไฟล์ในเอนจิน เสี่ยงทำเทสต์ที่มี
อยู่ 38 เคสพังถ้ารีบทำในรอบเดียวโดยไม่แยกเป็นขั้นตอนย่อย — ตั้งใจแยกเป็นงานถัดไปต่างหาก (ดู Consequences)

## Options Considered

| ตัวเลือก                                                                        | ทำไมไม่เลือก                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Resource ID เป็น data-driven เต็มรูปแบบต่อบท                                    | ต้องมี conversion table ข้ามบทสำหรับ Legacy ซับซ้อนเกินความคุ้มค่าของเกมขนาดนี้                                                                              |
| Legacy bonus ผูกกับ building/perk id เฉพาะบท (เช่น "มีวัดในบทก่อน → +1 ศรัทธา") | ใช้ไม่ได้ข้ามบทที่ไม่มี building นั้น ต้องมี mapping ต่อคู่บทซึ่งจะยิ่งซับซ้อนขึ้นเรื่อย ๆ ทุกบทใหม่ที่เพิ่ม (O(n²))                                         |
| Legacy ไม่มี cap ปล่อยให้สะสมอิสระ                                              | เสี่ยง snowball ร้ายแรง — ผู้เล่นที่เก่งบทแรกจะแทบไม่แพ้บทหลัง ขัดกับที่ ROADMAP.md ระบุไว้ตั้งแต่ต้นว่า "มีเพดานกัน snowball"                               |
| rewire เอนจินให้อ่าน `ChapterDefinition` ไปพร้อมกันเลยในรอบนี้                  | ขนาดงานใหญ่เกินจะทำในรอบเดียวอย่างรอบคอบ เสี่ยงทำของที่ทำงานอยู่แล้ว (38 เทสต์, เกมที่เล่นได้จริงวันนี้) พัง — แยกเป็นงานถัดไปที่ตรวจสอบได้เป็นขั้น ๆ ดีกว่า |

## Addendum (รอบต่อมาในวันเดียวกัน): เตรียมที่เก็บ Legacy ใน Supabase + วิธีทดสอบ migration โดยไม่ต้องมี Docker

เพิ่ม migration `supabase/migrations/20260921000000_chapter_legacy.sql`: คอลัมน์ `chapter_id` (nullable) บน
`games`, และตารางใหม่ `player_legacy` (`user_id, chapter_id` เป็น primary key — เล่นบทเดิมซ้ำแล้วจบใหม่คือ
upsert ทับ ใช้ผลรอบล่าสุดไม่ใช่ผลที่ดีที่สุด เป็นทางเลือกที่ตั้งใจให้ง่ายไว้ก่อน) RLS แบบเดียวกับตารางอื่น
(อ่านได้เฉพาะแถวของตัวเอง เขียนผ่าน service role เท่านั้น)

**ยังไม่ต่อเข้ากับ flow จริง** — ไม่มี route หรือจุดใดใน `GameService` เขียนหรืออ่านตารางนี้ เพราะ "จบเกมบท
ไหน → เขียนแถวนี้" กับ "เริ่มเกมบทไหน → อ่านแถวเหล่านี้มารวม" เป็น product flow ที่ยังไม่ได้ออกแบบ (เช่น
ผู้เล่นกลุ่มเดิมต้องเล่นบทถัดไปด้วยกันไหม ถ้าองค์ประกอบกลุ่มเปลี่ยนกลางทางจะทำยังไง) — จงใจไม่เดาออกแบบเอง
เพราะเป็นการตัดสินใจเชิงเกมเพลย์/ประสบการณ์ผู้เล่นที่ควรเป็นของลี ไม่ใช่ของ Claude

**ทดสอบ migration จริงได้โดยไม่ต้องมี Docker** — ใช้ `@electric-sql/pglite` (Postgres ตัวจริงคอมไพล์เป็น
WASM, มากับ npm package ตรง ๆ ไม่ต้องดาวน์โหลด binary แยกเหมือน `redis-memory-server` ที่เคยลองแล้วล้มเหลว
ในเฟส 5) รัน migration ทั้งสองไฟล์ (`20260918000000_init_schema.sql` เดิม + ไฟล์ใหม่) จริงกับ Postgres จริง
ในเครื่อง สร้างตาราง/คอลัมน์/primary key/RLS policy ได้ถูกต้องครบ แล้วทดสอบ upsert จริง (เล่นซ้ำบทเดิม →
แถวเดิมถูกทับ ไม่ใช่แถวใหม่) ผ่านหมด — ใช้ `auth` schema จำลองขั้นต่ำ (แค่ตาราง `auth.users` พอให้ foreign
key และ trigger ของ migration เดิมทำงานได้ กับฟังก์ชัน `auth.uid()` ที่คืน `null` เสมอ) **นี่คือ Postgres
จริง ไม่ใช่ของปลอมแบบที่ปฏิเสธไปสำหรับ Redis** (ดู ADR-0006 Addendum 2) — ต่างกันตรงที่ตรวจ SQL/constraint/
RLS policy ผ่านเอนจินฐานข้อมูลจริง ไม่ใช่ mock protocol ที่เขียนเองทั้งหมด — ข้อจำกัดที่ยังมีคือไม่ได้ทดสอบ
พฤติกรรม JWT/`auth.uid()` จริงของ Supabase Auth ที่ทำงานผ่าน PostgREST เท่านั้น (สภาพแวดล้อมนี้จำลองแค่ค่า
`null` ให้ DDL ผ่าน ไม่ได้จำลองการยืนยันตัวตนจริง) — ยังควรรันซ้ำกับ Supabase project จริง (`npx supabase db
push` หรือ SQL editor) ก่อนขึ้น production เหมือนเดิม

## Addendum 2 (รอบต่อมา): เริ่ม rewire จริง — แค่ชั้น setup ของ `createGame`

ทำสไลซ์แรกของ "ยังไม่ทำ" ข้อ 7 (rewire เอนจินให้อ่าน `ChapterDefinition` จริง): `createGame()` (`state.ts`)
รับ `opts.chapter?: ChapterDefinition` แล้วใช้ `chapter.seats`/`chapter.rules`/`chapter.foreignPowers` แทน
`SEATS`/`RULES`/`POWER_IDS` จาก `data.ts` ตรง ๆ — ค่า default ยังเป็น `earlyRattanakosinChapter` (ซึ่ง derive
จาก `data.ts` อยู่แล้ว) ดังนั้นพฤติกรรมเริ่มต้นเหมือนเดิม 100% (ยืนยันด้วยเทสต์ที่เทียบ state ตรง ๆ ว่า
`createGame({...})` กับ `createGame({..., chapter: earlyRattanakosinChapter})` ได้ state เท่ากันทุกบิต)

**ขอบเขตของสไลซ์นี้ — สำคัญที่ต้องเข้าใจ**: มีแค่ชั้น "ตั้งค่าเริ่มต้น" เท่านั้นที่ chapter-driven แล้ว
(ที่นั่ง, ทรัพยากรเริ่มต้น, เสถียรภาพเริ่มต้น, กองทหารรักษาเมืองหลวง, รายชื่อมหาอำนาจต่างชาติ) — `economy.ts`/
`turn.ts`/`ai.ts`/`combat.ts`/`powers.ts`/`endings.ts`/`actions.ts`/`views.ts`/`hex.ts`/`movement.ts` (10
จาก 12 ไฟล์ในเอนจิน) **ยังคง import จาก `data.ts` ตรง ๆ เหมือนเดิม** ผลคือ: ส่ง chapter ที่มี building/
terrain/perk/power id ต่างจาก `data.ts` เข้าไปตอนนี้จะสร้าง `GameState` ได้ก็จริง แต่พอเริ่มเล่น (คำนวณ
รายได้เมือง, การรบ, AI ตัดสินใจ) จะพังแบบเงียบ ๆ (id ไม่รู้จัก → yield เป็น 0 หรือ error) — **ยังใช้เล่นบท
อื่นที่ต่างจาก `data.ts` จริงไม่ได้** จนกว่าจะ rewire ไฟล์ที่เหลือ

**ทำไมหยุดแค่นี้ในรอบนี้**: `state.ts` เป็นจุดเดียวที่แยก "ตั้งค่า" ออกจาก "กลไกระหว่างเล่น" ได้ชัดเจนโดยไม่
ต้องแตะฟังก์ชันอื่น เปลี่ยนแล้วพิสูจน์ได้ทันทีว่าพฤติกรรมเดิมไม่เปลี่ยน (43 เทสต์ผ่านหมด รวมเทสต์ใหม่ 5 เคส
ที่ตรวจตรง ๆ ว่าอ่านจาก chapter จริง ไม่ใช่จาก `data.ts` โดยบังเอิญ) — ไฟล์ที่เหลืออีก 10 ไฟล์ผูกกันแน่นกว่า
มาก (เช่น `economy.cityYield` ต้อง lookup ทั้ง `TERRAIN` และ `BUILDINGS`, `ai.ts` ตัดสินใจโดยอ้างอิง `RULES`
หลายสิบค่า) เปลี่ยนพร้อมกันหมดในรอบเดียวเสี่ยงเหมือนที่เตือนไว้ในข้อ 7 เดิม — แบ่งเป็นสไลซ์ต่อไปดีกว่า

**ข้อจำกัดที่ยอมรับไว้ (cast ที่ขอบเขต)**: `types.ts` ยังไม่เปลี่ยน (`Faction.seat: SeatId`,
`City.buildings: BuildingId[]` ยังเป็น literal union) แต่ `ChapterDefinition` (schema.ts) ใช้ `string`
ทั่วไปเพื่อให้ data-driven ได้จริง — จุดต่อระหว่างสองฝั่งนี้ใน `createGame()` จึงมี type cast ที่ตั้งใจ 2 จุด
(`seat.id as Faction['seat']`, `seat.city.buildings as City['buildings']`) กำกับด้วยคอมเมนต์อธิบายไว้ —
`validateChapterDefinition()` ตรวจโครงสร้างได้ แต่ไม่ได้ตรวจว่า string ตรงกับ literal union ของ `types.ts`
เป๊ะ ๆ (เพราะ `types.ts` เองก็ยังไม่ data-driven) — จะหมดปัญหานี้เมื่อ `types.ts` ถูก generalize เป็นส่วนหนึ่ง
ของ rewire รอบถัดไป

## Addendum 3 (รอบต่อมา): พบข้อจำกัดสำคัญของแผน rewire เดิม — กลไกเฉพาะบทฝังอยู่ในโค้ด ไม่ใช่แค่ข้อมูล

ระหว่างจะ rewire `economy.ts`/`turn.ts` ต่อจาก Addendum 2 (ทำ `cityYield`/`computeIncome` ให้อ่าน
`chapter.terrain`/`chapter.buildings`/`chapter.rules` แทน `data.ts`) พบว่าแผนเดิม ("สลับ import จาก
`data.ts` เป็น `chapter.X`") ใช้ไม่ได้ตรง ๆ กับทุกจุด เพราะมีโค้ดหลายจุดที่ฝัง**กลไกเฉพาะของบทนี้**ไว้ใน
ตรรกะจริง ไม่ใช่แค่ตัวเลขในตาราง:

- `economy.ts` คำนวณรายได้โดยอ้างอิง perk id ตรง ๆ: `hasPerk(f, 'irrig') ? 1.2 : 1` (ข้าว +20%),
  `hasPerk(f, 'print')` (ความรู้ +30%) — schema (`PerkDefData`) มีแค่ `{id, at, name, desc}` ไม่มีข้อมูล
  "ผล" ของ perk เลย ผลจริงเขียนเป็นโค้ด hardcode ตรงนี้
- `combat.ts` เช่นกัน: `hasPerk(attF, 'powder') ? 1.2 : 1` (โบนัสรบ +20%)
- `turn.ts` อ้างอิง building id ตรง ๆ (`buildings.includes('temple')` ให้เสถียรภาพ, `includes('granary')`
  ลดความเสียหายน้ำท่วม) และ terrain id ตรง ๆ (`terrainAt(...) === 'C'` = "พื้นที่ลุ่มเสี่ยงน้ำท่วม")
  เหตุการณ์ประจำฤดู (น้ำท่วมหน้าฝน, งานบุญหน้าหนาว, ภัยแล้งหน้าร้อน) เป็น narrative เฉพาะภูมิศาสตร์ลุ่มน้ำ
  เจ้าพระยา เขียนเป็นโค้ดตรง ๆ ไม่ใช่ข้อมูล
- `turn.ts` อ้างอิง `f.powers.lion.patience`/`f.powers.eagle.patience` ตรง ๆ — กลไก "ไผ่ลู่ลม" ระหว่าง
  สองมหาอำนาจเป็นกลไกที่ผูกกับ `PowerId` literal 2 ค่านี้เท่านั้น แม้แต่ `Faction.powers` (types.ts) เองก็
  พิมพ์เป็น `Record<PowerId, {patience}>` ตายตัว

**คำถามที่ต้องให้ลีตัดสินใจก่อนไปต่อ**: 6 บทมีกลไกแกนกลาง (bamboo diplomacy ระหว่างสองมหาอำนาจ, เหตุการณ์
ประจำฤดูแบบนี้, สูตรเศรษฐกิจแบบนี้) **เหมือนกันทุกบทแค่เปลี่ยนหน้าตา/ชื่อ** หรือ**แต่ละบทควรมีกลไกต่างกันจริง
ตามยุค** (เช่น บทก่อนประวัติศาสตร์อาจไม่มี "มหาอำนาจต่างชาติกดดันทางการทูต" เป็นกลไกเลย) — คำตอบเปลี่ยนขนาด
งานที่เหลือทั้งหมด: ถ้าเป็นแบบแรก แค่ต้องทำ **ระบบ "effect" ทั่วไป** (เช่น `PerkDef.effect: {resource,
multiplier}`, `SeasonalEventDef` ที่ประกาศเงื่อนไข/ผลเป็นข้อมูลแทนโค้ด) ซึ่งยังใหญ่แต่ทำได้ในเอนจินเดียว
ถ้าเป็นแบบหลัง จะต้องมีจุดขยาย (hook) ให้แต่ละบทเสียบตรรกะของตัวเองได้ ซึ่งเป็นงานสถาปัตยกรรมที่ใหญ่กว่ามาก

**ตัดสินใจไว้ก่อน**: ไม่รีบเดาเอง หยุด rewire ที่ `economy.ts`/`turn.ts`/`combat.ts` ไว้ตรงนี้ (โค้ดยังอยู่ใน
สภาพทำงานได้ ทดสอบผ่านครบ ไม่มีอะไรพัง) รอคำตอบจากลีก่อนว่าอยากให้ไปทางไหน — สไลซ์ `state.ts` ที่ทำไปแล้ว
(Addendum 2) ยังมีประโยชน์ไม่ว่าคำตอบจะเป็นทางไหน เพราะชั้น "ตั้งค่าเริ่มต้น" เป็น data-driven ได้จริงไม่ว่า
กรณีไหน

## Addendum 4 (รอบต่อมา): ลีตัดสินใจแล้ว — เหมือนกันทุกบท แค่เปลี่ยนหน้าตา → เริ่มระบบ "effect" ทั่วไป

ลีตอบคำถามใน Addendum 3 แล้ว: **6 บทใช้กลไกแกนกลางเดียวกัน แค่เปลี่ยนชื่อ/หน้าตา/ตัวเลข ไม่ใช่กลไกต่างกันจริง
ตามยุค** — แปลว่าทางที่ถูกคือสร้าง **ระบบ effect ทั่วไปในเอนจินเดียว** (perk ประกาศ "ผล" เป็นข้อมูล ไม่ใช่
สาขาโค้ดที่ผูกกับ perk id ตรง ๆ) ไม่ใช่จุดขยาย (hook) ให้แต่ละบทเสียบตรรกะของตัวเอง

ทำสไลซ์แรกของระบบนี้แล้ว — **perk effects**:

- `PerkDefData` (schema.ts) เพิ่มฟิลด์ `effects: readonly PerkEffect[]` โดย `PerkEffect` เป็น discriminated
  union: `{kind:'resourceMultiplier', resource: CoreResourceId, multiplier: number}` กับ
  `{kind:'combatMultiplier', multiplier: number}` — `data.ts`'s `PERKS` ประกาศ effect จริงของ 3 perk เดิม
  (`irrig`→rice×1.2, `powder`→combat×1.2, `print`→know×1.3) เป็นข้อมูลแบบนี้แทนโค้ด
- **`GameState` มีฟิลด์ใหม่ `chapterId: string`** — จุดที่ขาดไปก่อนหน้านี้: `createGame` เซ็ต `chapterId`
  ตอนสร้างเกม แต่ไม่เคยเก็บไว้ใน state เลย ฟังก์ชัน pure อย่าง `computeIncome`/`checkPerks`/`resolveBattle`
  เลยไม่มีทางรู้ว่าเกมนี้มาจากบทไหน — เพิ่ม registry เล็ก ๆ `content/chapters/index.ts` (`CHAPTERS`,
  `getChapterById`) ให้ฟังก์ชันเหล่านี้ lookup เนื้อหาบทจาก `s.chapterId`/`ctx.s.chapterId` แทนการรับ
  `ChapterDefinition` เป็นพารามิเตอร์เพิ่ม (คง signature เดิมไว้ ไม่กระทบ caller ใน `turn.ts`/`ai.ts`/
  `actions.ts`/เว็บ) — เหตุผลที่เก็บแค่ `chapterId: string` ใน `GameState` แทนที่จะฝัง `ChapterDefinition`
  ทั้งก้อน: ไม่อยากให้ snapshot ที่ส่งผ่านเครือข่ายหรือเก็บใน Supabase ทุกเทิร์นพองขึ้นเพราะแบก map/buildings/
  perks ทั้งบทไปด้วย — same pattern ที่ `data.ts` เดิมไม่เคยฝังใน `GameState` เหมือนกัน
- `economy.ts` เพิ่ม `resourceMultiplier(f, resource, chapter)` — คูณ effect ของทุก perk ที่ปลดล็อกแล้วที่
  ตรงกับ resource นั้น (`kind:'resourceMultiplier'`) แทน `hasPerk(f,'irrig')?1.2:1`/`hasPerk(f,'print')`
  เดิม — `computeIncome` เรียกใช้แทน — `checkPerks` เปลี่ยนมาวน `chapter.perks` (จาก registry) แทน `PERKS`
  จาก `data.ts` ตรง ๆ ด้วย เพื่อให้ "perk ที่มีอยู่จริง" มาจากแหล่งเดียวกับ "ผลของ perk"
- `combat.ts` เพิ่ม `combatMultiplier(f, chapter)` แทน `hasPerk(attF/defF,'powder')?1.2:1` เดิม —
  `resolveBattle` เรียกใช้แทน — บรรทัด flavor text ที่เคย hardcode ชื่อ "วิทยาการดินปืน" กับ `×1.2` ตรง ๆ
  ก็ทำให้ทั่วไปด้วย (พิมพ์ตัวคูณจริงที่คำนวณได้ ไม่ผูกกับชื่อ perk เฉพาะ)
- เทสต์ใหม่ 5 เคสใน `content-schema.test.ts` พิสูจน์ตรง ๆ ว่าไม่ได้แอบผูกกับ literal string `'irrig'`/
  `'powder'`/`'print'` อีกต่อไป — เคสสำคัญที่สุดคือสร้าง perk ที่เอนจินไม่เคยรู้จักชื่อเลย (`'monsoon-canals'`,
  `'steel-hulls'`) แล้วพิสูจน์ว่า `resourceMultiplier`/`combatMultiplier` ยังใช้ effect data ได้ถูกต้อง

**ขอบเขตที่ยังไม่ทำ (ตั้งใจหยุดตรงนี้)**:

1. **Registry lookup ผูกกับ id ไม่ใช่ object ที่ส่งเข้า `createGame`** — `checkPerks`/`computeIncome`/
   `resolveBattle` อ่านเนื้อหาบทจาก `getChapterById(s.chapterId)` (ของที่ลงทะเบียนไว้ใน `CHAPTERS`) ไม่ใช่
   จาก `ChapterDefinition` object ที่ส่งเข้า `createGame({chapter: ...})` ตรง ๆ — ถ้า object ที่ส่งเข้ามามี
   `manifest.id` เดียวกับที่ลงทะเบียนไว้แต่ `perks`/`rules` ต่างกัน ผลจริงตอนเล่นจะยึดตามของที่ลงทะเบียน ไม่ใช่
   ของที่ส่งเข้ามา — ยังไม่กระทบอะไรตอนนี้เพราะมีแค่บทเดียวในระบบ จะเริ่มสำคัญเมื่อมีบทที่สองลงทะเบียนจริง
2. **เหตุการณ์ประจำฤดู (`turn.ts`) กับกลไกสองมหาอำนาจ (bamboo diplomacy) ยังไม่แปลงเป็นข้อมูล** — ยัง
   hardcode `buildings.includes('temple'/'granary')`, `terrainAt(...) === 'C'`, `f.powers.lion.patience`/
   `f.powers.eagle.patience` เหมือนเดิมทุกอย่าง — Addendum 3 ระบุไว้แล้วว่าเป็นงานที่เหลือ ตอนนี้แค่ยืนยัน
   ทิศทาง (ระบบ effect ทั่วไป ไม่ใช่ hook ต่อบท) แต่ยังไม่ได้ลงมือแปลงสองจุดนี้ — เป็นสไลซ์ถัดไป
3. `ai.ts`/`powers.ts`/`endings.ts`/`actions.ts`/`views.ts`/`hex.ts`/`movement.ts` ยัง import จาก `data.ts`
   ตรง ๆ เหมือนเดิม ไม่กระทบ
4. `GameState.schemaVersion` ยังไม่ขยับจาก `1` แม้ `GameState` จะได้ฟิลด์บังคับใหม่ (`chapterId`) — โปรเจกต์
   ยังไม่ปล่อยจริง ยังไม่มีระบบ migrate save เก่า ตั้งใจไม่ทำตอนนี้ (save/เกมค้างใน localStorage ของเครื่อง
   dev ที่สร้างไว้ก่อนหน้านี้จะใช้ต่อไม่ได้ ต้องเริ่มเกมใหม่ — ยอมรับผลนี้เพราะยังไม่มีข้อมูลผู้เล่นจริง)

ยืนยันด้วย: `npm run typecheck` ผ่านทั้ง engine/server/web, engine test suite 48 เคสผ่านหมด (43 เดิม + 5
ใหม่), server 63 เคสผ่านหมด (9 skip ตามเดิม เพราะ Redis), web 29 เคสผ่านหมด, `eslint .` และ
`prettier --check` สะอาด, `npm run build -w @siam/engine` ผ่าน

## Addendum 5 (รอบต่อมา): ขยายระบบ effect ไปถึงอาคาร/ภูมิประเทศ/สองมหาอำนาจ

ต่อจาก Addendum 4 (ระบบ effect ของ perk) — ทำสไลซ์ที่สองตามทิศทางเดียวกัน (ลีตัดสินใจแล้วว่า 6 บทใช้กลไก
แกนกลางเดียวกัน แค่เปลี่ยนหน้าตา) โดยแปลงจุดที่เหลือใน Addendum 3 ที่ยังทำได้โดยไม่ต้องคิดค้น schema
เหตุการณ์ประจำฤดูแบบเต็มรูปแบบ:

- **อาคารประกาศผลเป็นข้อมูล** — `BuildingDefData` เพิ่ม `effects?: readonly BuildingEffect[]`
  (`stabilityPerCity` / `disasterLossReduction`) `data.ts` ประกาศผลจริงของ `temple` (เสถียรภาพ +1 ต่อเมือง)
  และ `granary` (ลดความเสียหายน้ำท่วมเหลือ 8) เป็นข้อมูลแทน `buildings.includes('temple')`/
  `buildings.includes('granary')` ที่ hardcode ไว้เดิมใน `turn.ts`
- **ภูมิประเทศประกาศความเสี่ยงภัยเป็นข้อมูล** — `TerrainDefData` เพิ่ม `disasterExposure?: readonly string[]`
  `TERRAIN.C` (ที่ราบลุ่ม) ประกาศ `['flood']` แทน `terrainAt(...) === 'C'` ที่ hardcode ไว้เดิม — `disaster`
  เป็น free-form string (ไม่ใช่ enum) เพื่อให้บทอื่นนิยามภัยพิบัติที่เอนจินไม่เคยรู้จักได้ (เช่น แผ่นดินไหว
  ดินถล่ม) โดยไม่ต้องแก้ type
- **กลไกไผ่ลู่ลม (สองมหาอำนาจ) ทั่วไปแล้ว ไม่ผูกกับ `lion`/`eagle` ตรง ๆ** —
  - `turn.ts`'s `internalAffairs`: เดิม `f.powers.lion.patience >= 2 && f.powers.eagle.patience >= 2`
    (เช็คตรงกับ 2 ชื่อนี้เท่านั้น) → ตอนนี้ `allPowersPatient(f, chapter)` เช็คว่าทุกมหาอำนาจที่บทลงทะเบียน
    ไว้มีความอดทน ≥ 2 หมด — ใช้ได้กับกี่มหาอำนาจก็ได้ ไม่ใช่ผูกตายตัวกับ 2
  - `powers.ts`'s `offeringPower`: เดิม `year % 2 === 1 ? 'lion' : 'eagle'` (สลับตรงระหว่าง 2 ชื่อนี้) →
    ตอนนี้ `offeringPower(chapter, year)` วนตามลำดับมหาอำนาจที่บทประกาศไว้จริง (`Object.keys(chapter.
foreignPowers)`) — สำหรับบทที่ชิปวันนี้ (2 มหาอำนาจ) ให้ผลเหมือนเดิมทุกประการ
  - `powers.ts` ทั้งไฟล์ (queueOffer/queueUltimatum/applyOffer/answerDecision/sendEnvoy/shiftMeter) รื้อจาก
    อ่าน `POWERS`/`DEMANDS`/`COSTS`/`RULES` ของ `data.ts` ตรง ๆ มาอ่านจาก `chapter.foreignPowers`/
    `chapter.demands`/`chapter.costs`/`chapter.rules` ผ่าน `getChapterById(ctx.s.chapterId)` แทน — ปิดไฟล์
    นี้ทั้งไฟล์จากรายการที่ยัง "import จาก data.ts ตรง ๆ" ใน Addendum 2/3
  - `turn.ts` เปลี่ยนทุกจุดที่อ้าง `RULES.*` (dangerZone/balancedZone/balancedKnowBonus/extremeLimit/
    aiWarThreshold/aiWarChance/expansionIrritation) เป็น `chapter.rules.*` เช่นกัน เพราะ `ChapterRulesData`
    มีฟิลด์เหล่านี้ครบอยู่แล้วตั้งแต่ Addendum 1 ไม่ต้องเพิ่ม schema ใหม่
  - `apps/web/src/ui/BambooTab.tsx` ปรับตามลายเซ็นใหม่ของ `offeringPower` (ส่ง `earlyRattanakosinChapter`
    เข้าไปตรง ๆ เพราะเว็บยังไม่ chapter-aware — ขอบเขตเดิม) และถือโอกาสทำให้การคำนวณ "ใครจะยื่นข้อเสนอปี
    หน้า" ทั่วไปด้วย (เดิม `thisYear === 'lion' ? 'eagle' : 'lion'` ก็ผูกกับ 2 ชื่อนี้เหมือนกัน)
- เทสต์ใหม่ 10 เคส พิสูจน์ทั้งความเท่ากันกับพฤติกรรมเดิม (`buildingStabilityBonus`/`disasterMitigation`/
  `allPowersPatient`/`offeringPower` ให้ผลตรงกับบทที่ชิปวันนี้ทุกกรณี รวมเทสต์ end-to-end ผ่าน `endTurn`
  จริงที่ผูกกับค่าที่ประกาศในข้อมูลโดยตรง ไม่ hardcode ตัวเลขซ้ำในเทสต์) และความเป็นระบบทั่วไปจริง (สร้าง
  อาคาร/ภัยพิบัติ/มหาอำนาจที่เอนจินไม่เคยเห็นชื่อมาก่อน เช่น `shrine-of-unity`, `seawall`+`tsunami`, บทที่มี
  มหาอำนาจ 1 หรือ 3 ราย ชื่อ `north`/`south`/`east` แล้วพิสูจน์ว่ากลไกยังทำงานถูกต้อง — รวมถึงเคสบทที่ไม่มี
  มหาอำนาจเลยต้อง throw ข้อความชัดเจนแทนที่จะวนลูปพัง)

**ขอบเขตที่ยังไม่ทำ (ตั้งใจหยุดตรงนี้)**: ตัวโครงสร้างเหตุการณ์ประจำฤดูเอง (ฤดูไหนเกิดอะไรได้บ้าง, โอกาส
เกิดเท่าไร, ข้อความบรรยาย, ผลกระทบต่อความสัมพันธ์ทางการทูต) ยัง hardcode เป็นโค้ดใน `seasonalEvents`
เหมือนเดิมทั้งหมด — ที่แปลงได้ในรอบนี้คือ "ภูมิประเทศไหนเสี่ยงภัยอะไร" กับ "อาคารไหนลดความเสียหายเท่าไร"
เท่านั้น เพราะสองอย่างนี้มีรูปแบบชัดเจนพอจะออกแบบ schema ได้โดยไม่ต้องเดา ส่วนเหตุการณ์ทั้งหมด (ฤดูฝนน้ำท่วม,
ฤดูหนาวงานบุญ/กระทบกระทั่งชายแดน, ฤดูร้อนภัยแล้ง/ของขวัญ) ยังเป็นเนื้อหาเฉพาะภูมิศาสตร์ลุ่มน้ำเจ้าพระยาที่
ผูกกับฤดูกาลไทย 3 ฤดู — ออกแบบ `SeasonalEventDef` แบบเต็มรูปแบบตอนนี้เสี่ยงเดาผิดเพราะยังไม่รู้ว่าอีก 5 บทที่
เหลือ (รอที่ปรึกษาประวัติศาสตร์ตาม ROADMAP.md) ต้องการเหตุการณ์แบบไหนจริง ๆ — รอเนื้อหาบทจริงอย่างน้อยอีกบท
หนึ่งก่อนออกแบบ schema นี้จะปลอดภัยกว่า เก็บไว้เป็นงานถัดไปที่ยังไม่ลงมือ

ยืนยันด้วย: `npm run typecheck` สะอาดทั้ง engine/server/web, engine test suite 58 เคสผ่านหมด (48 เดิม + 10
ใหม่), server 63 เคสผ่านหมด (9 skip ตามเดิม), web 29 เคสผ่านหมด, `eslint .` และ `prettier --check` สะอาด,
`npm run build -w @siam/engine` ผ่าน

## Addendum 6 (รอบต่อมา): endings/actions/views + ครึ่งหนึ่งของ ai.ts อ่านจาก chapter — และเหตุผลที่หยุดก่อนแตะ hex.ts/movement.ts

ต่อจาก Addendum 5 — ตรวจไฟล์ที่เหลือทั้งหมดที่ยัง `import ... from './data.js'` ตรง ๆ (`ai.ts`/`endings.ts`/
`actions.ts`/`views.ts`/`hex.ts`/`movement.ts`) ทีละไฟล์ เพื่อแยกว่าไฟล์ไหนเป็นกลไกที่ผูกกับเนื้อหา (ต้องรื้อ)
กับไฟล์ไหนเป็น chassis/เรขาคณิตล้วน ๆ:

- **`ChapterDefinition` เพิ่มฟิลด์ `newCityNames: readonly string[]`** (พร้อม validation ว่าต้องมีอย่างน้อย 1
  ชื่อ) — พอร์ต `NEW_CITY_NAMES` จาก `data.ts` เข้า `early-rattanakosin.ts` แบบเดียวกับฟิลด์อื่น เป็นช่องว่าง
  schema จริงที่เพิ่งเจอตอนรื้อ `found` handler (พูลชื่อเมืองใหม่ไม่เคยอยู่ใน schema เลยตั้งแต่ Addendum 1)
- **`endings.ts`** — `evaluateEnding`/`finishGame` อ่าน `chapter.endings`/`chapter.rules.extremeLimit`/
  `chapter.rules.balancedZone` แทน `ENDINGS`/`RULES` — แต่จงใจ**ไม่แตะ**โครงสร้างการตัดสินตอนจบ (`EndingId`
  6 ค่า, ลำดับเงื่อนไข, เกณฑ์ตัวเลข) เพราะตรงกับคำตอบของลีใน Addendum 4 ("เหมือนกันทุกบทแค่เปลี่ยนหน้าตา")
  ที่สุด: `EndingId` เป็น literal union คงที่แบบเดียวกับ `CoreResourceId` — ตอนจบ 6 แบบกับกลไกตัดสินเป็น
  chassis ของทุกบท มีแค่ชื่อ/ไอคอน/ข้อความที่เปลี่ยนต่อบท ซึ่ง `chapter.endings[id]` ให้อยู่แล้ว
- **`actions.ts` ทั้งไฟล์** — `BUILDINGS`/`COSTS`/`NEW_CITY_NAMES`/`RULES` เปลี่ยนเป็น `chapter.buildings`/
  `chapter.costs`/`chapter.newCityNames`/`chapter.rules` — `Handler<A>` ได้พารามิเตอร์ตัวที่ 4
  `chapter: ChapterDefinition` และ `applyAction` resolve `getChapterById(s.chapterId)` ครั้งเดียวก่อนเรียก
  handler (handler ที่ไม่ใช้ chapter อย่าง `move`/`attack`/`camp`/`envoy`/`answerDecision`/`endTurn` ไม่ต้อง
  แก้ signature — TypeScript ยอมให้ฟังก์ชันที่รับพารามิเตอร์น้อยกว่าเข้ากับ type ที่มีพารามิเตอร์มากกว่า)
  signature สาธารณะของ `applyAction`/`foundBlocker` ไม่เปลี่ยน จึงไม่กระทบ server/web
- **`views.ts`** — `describeDecision` อ่าน `chapter.foreignPowers`/`chapter.demands`/`chapter.costs.ultimatum`
  แทน `POWERS`/`DEMANDS`/`COSTS`
- **`ai.ts` ครึ่งเดียวโดยตั้งใจ** — `RULES.aiRecruitStr`/`aiRecruitCooldown`/`aiPeaceStrCap`/`aiWarStrCap`/
  `aiWeakStr` เป็น `chapter.rules.*` แล้ว แต่บรรทัดค่าเดินใน `stepAlong` (`TERRAIN[terrainAt(...)].cost`)
  ยัง import `TERRAIN` จาก `data.ts` ตรง ๆ — เป็นโค้ดตัวเดียวกับที่ `movement.ts` ใช้ จึงผูกกับการตัดสินใจ
  เรื่อง hex.ts/movement.ts ด้านล่าง (มีคอมเมนต์ชี้มาที่ addendum นี้ในไฟล์)

**ตัดสินใจไม่ทำ (ไม่ใช่แค่ยังไม่ได้ทำ): `hex.ts`/`movement.ts`** — ต่างจากไฟล์อื่นโดยพื้นฐาน ด้วยเหตุผล 4 ข้อ:

1. **`hex.ts` คำนวณ `ROWS`/`COLS`/`riverSet` เป็น module-level singleton ตอน import** (จาก `MAP`/`RIVER`)
   ไม่ใช่ค่าที่คำนวณต่อ call — ทำให้ทั่วไปต้องเปลี่ยนแทบทุกฟังก์ชันเรขาคณิต (`tileAt`/`terrainAt`/
   `neighbors`/`hexCenter`/`pixelToHex`/`tilesWithin` ฯลฯ) ให้รับแผนที่เป็นพารามิเตอร์
2. **ใช้กว้างกว่าเอนจิน** — `apps/web/src/map/MapRenderer.ts`/`geometry.ts` เรียก `hex.ts` ตรง ๆ เพื่อวาด
   แผนที่โดยไม่ผ่าน `GameState` การรื้อจะลามไปทั้งสอง package
3. **เซิร์ฟเวอร์ถือหลายเกมพร้อมกันในโปรเซสเดียว** — ถ้าเปลี่ยน singleton เป็น state ต่อบท ต้องกันไม่ให้สอง
   เกมที่ใช้บทต่างกันพร้อมกันชนกัน เป็นความเสี่ยงด้านความถูกต้องที่ไฟล์อื่นไม่มี (ไฟล์อื่นรับ `chapter` ต่อ
   call อยู่แล้ว)
4. **ยังไม่รู้ว่าบทอื่นจะมีแผนที่ของตัวเองจริงไหม** — เป็นไปได้ที่ 6 บทใช้ภูมิศาสตร์ลุ่มน้ำเดียวกันต่างยุค
   และความต่างเชิงกลไกทั้งหมดมาจาก `chapter.terrain`/`chapter.buildings` ที่เป็นข้อมูลแล้ว โดยไม่ต้องมีแผนที่
   hex ต่างกันเลย — รื้อตอนนี้เสี่ยงเดาโครงสร้างผิด เหตุผลเดียวกับที่เลื่อน `SeasonalEventDef` ใน Addendum 5
   (รอเนื้อหาบทจริงอย่างน้อยอีกหนึ่งบท)

**เทสต์ใหม่ 5 เคส**ใน `content-schema.test.ts` — ฟังก์ชันกลุ่มนี้รับ `GameState` ไม่ใช่ `ChapterDefinition`
จึงพิสูจน์ความเป็นระบบทั่วไปด้วยการลงทะเบียนบททดสอบชั่วคราวใน `CHAPTERS` แล้วถอดออกใน `finally`
(จำลองวิธีลงทะเบียนบทที่สองจริง):

- `found` ใช้ชื่อเมือง/ต้นทุน/กองรักษาการณ์จาก `chapter.newCityNames`/`chapter.costs.found`/
  `chapter.rules.newCityGarrison` (ชื่อเมืองที่ไม่มีในรายการจริงเลย, ต้นทุนเทียบกับ `scaleCost` ตามฤดูจริง)
- `build` ใช้ต้นทุนจาก `chapter.buildings.market.cost` — id เดิมแต่ค่าต่างกัน เพราะ `BuildingId` ยังเป็น
  literal union คงที่ (แบบเดียวกับ `EndingId`/`PowerId`) คิด id ใหม่จะไม่ผ่าน TypeScript
- `runAi` เกณฑ์ทัพสำรองด้วย `chapter.rules.aiRecruitStr`/`aiRecruitCooldown`
- `describeDecision` ใช้ชื่อมหาอำนาจ/ข้อเรียกร้องจาก `chapter.foreignPowers`/`chapter.demands`
- `finishGame` บันทึก chronicle ด้วยชื่อตอนจบจาก `chapter.endings`

export เพิ่มจาก `index.ts` ให้เทสต์เรียกตรงได้: `runAi`, `finishGame` และ type `Ctx` (แบบเดียวกับที่ export
`buildingStabilityBonus` ฯลฯ ใน Addendum 5) — และแก้คอมเมนต์ `CreateGameOptions.chapter` ใน `state.ts` ที่
ล้าสมัยมาตั้งแต่ Addendum 5 (ยังบอกว่า `powers.ts`/อาคาร/ภูมิประเทศ hardcode อยู่) ให้ตรงกับสถานะจริง

ยืนยันด้วย: `npm run typecheck` สะอาดทั้ง engine/server/web, engine 63 เคสผ่านหมด (58 เดิม + 5 ใหม่), server
63 เคสผ่านหมด (9 skip ตามเดิม), web 29 เคสผ่านหมด, `eslint` ทั้ง src ของสาม package สะอาด, `prettier --check`
สะอาด

## Consequences

- เกมที่ชิปวันนี้ (`data.ts` เดิม) **ไม่เปลี่ยนพฤติกรรมเลย** — ของใหม่ทั้งหมดอยู่ใน `packages/engine/src/content/`
  เป็น opt-in ยังไม่มีอะไรเรียกใช้จาก `createGame`/routes จริง
- **ทำแล้วบางส่วน (Addendum 2)**: `createGame` อ่าน seats/starting rules/foreign powers จาก
  `ChapterDefinition` แล้ว
- **ทำแล้วบางส่วน (Addendum 4+5, ตามคำตอบลี — เหมือนกันทุกบทแค่เปลี่ยนหน้าตา)**: ระบบ effect ทั่วไปสำหรับ
  perk (`resourceMultiplier`/`combatMultiplier`), อาคาร (`stabilityPerCity`/`disasterLossReduction`),
  ภูมิประเทศ (`disasterExposure`) และกลไกสองมหาอำนาจ (`allPowersPatient`/`offeringPower` ทั่วไปแล้ว ไม่ผูก
  `lion`/`eagle` ตรง ๆ, `powers.ts` ทั้งไฟล์อ่านจาก chapter แล้ว) — `GameState.chapterId` + registry
  (`content/chapters/index.ts`) ให้ฟังก์ชัน pure lookup เนื้อหาบทได้จริง — **ยังไม่ทำ**: โครงสร้างเหตุการณ์
  ประจำฤดูเอง (ฤดูไหนเกิดอะไร, โอกาสเกิด, ข้อความ) ยังฝังเป็นโค้ดใน `turn.ts`'s `seasonalEvents` เหมือนเดิม
  — ตั้งใจรอเนื้อหาบทจริงอีกอย่างน้อยหนึ่งบทก่อนออกแบบ schema นี้ (ดู Addendum 5)
- **ทำแล้ว (Addendum 6)**: `endings.ts`/`actions.ts`/`views.ts` และส่วน balance rules ของ `ai.ts` อ่านจาก
  chapter แล้ว + ฟิลด์ใหม่ `newCityNames` — **ตัดสินใจไม่ทำตอนนี้**: `hex.ts`/`movement.ts` (และบรรทัดค่าเดินใน
  `ai.ts`) ยังอ่าน `MAP`/`TERRAIN`/`RIVER` จาก `data.ts` เป็น singleton เพราะกระทบ renderer ของเว็บ, เสี่ยงชนกัน
  ระหว่างหลายเกมบนเซิร์ฟเวอร์ และยังไม่รู้ว่าบทอื่นจะมีแผนที่ของตัวเองจริงไหม (ดู Addendum 6)
- **ทำแล้ว (รอบต่อมาในวันเดียวกัน)**: ตาราง `player_legacy` + คอลัมน์ `games.chapter_id` — migration
  ทดสอบจริงกับ Postgres จริงผ่าน pglite แล้ว (ดู Addendum) — **ยังไม่ทำ**: ต่อเข้ากับ flow จริง (จบเกม →
  เขียนแถว, เริ่มเกมบทใหม่ → อ่านแถวมารวม) เพราะเป็นการตัดสินใจเชิงเกมเพลย์ที่ควรเป็นของลี ไม่ใช่ของ Claude
  (รายละเอียดใน Addendum) ฟังก์ชัน pure `computeLegacyBonuses`/`mergeLegacyBonuses`/`applyLegacyBonuses`
  พร้อมให้ server เรียกใช้แล้วเมื่อ flow ถูกออกแบบ
- **ยังไม่ทำ**: เนื้อหาจริงของอีก 5 บท (ก่อนประวัติศาสตร์, ทวารวดี/รัฐแรกเริ่ม, สุโขทัย/อยุธยาตอนต้น,
  สมัยใหม่/สงครามโลก, ปัจจุบัน) — ต้องมีที่ปรึกษาประวัติศาสตร์ตามที่ ROADMAP.md ระบุ และการจัดวางบท 4 ที่ทำ
  ในรอบนี้เป็นแค่ข้อเสนอเริ่มต้น
- tech tree, การ์ดขุนพล, Tactical View, Timeline Replay ยังไม่แตะเลย (ข้ออื่นของ ROADMAP.md เฟส 6)
- เทสต์ใหม่ 10 เคสใน `packages/engine/test/content-schema.test.ts` ครอบคลุม: schema ยอมรับเนื้อหาที่พอร์ต
  มาจริง, schema ปฏิเสธเนื้อหาที่ผิดโครงสร้างพร้อมบอกปัญหาทุกจุด, legacy bonus ไม่มีทางเกิน cap แม้ input
  สุดขั้ว, legacy คำนวณแบบ deterministic, merge หลายบทยัง cap ซ้ำได้ถูกต้อง — engine test suite เดิม 28
  เคสยังผ่านหมดไม่กระทบ (รวม 38 เคส)
