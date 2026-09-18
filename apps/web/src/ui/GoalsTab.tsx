import { ENDINGS, RULES, endingProgress } from '@siam/engine';
import { ME, useStore } from '../store';

export function GoalsTab() {
  const state = useStore((s) => s.state);
  const me = state.factions[ME]!;
  const p = endingProgress(state, me);

  const item = (cls: string, text: string) => (
    <li className={cls} key={text}>
      {cls === 'ok' ? '✓' : cls === 'hit' ? '!' : '○'} {text}
    </li>
  );
  const ok = (b: boolean) => (b ? 'ok' : '');
  const card = (id: keyof typeof ENDINGS, items: React.ReactNode[]) => (
    <div className="card" key={id}>
      <div className="ch">
        <span style={{ fontSize: 20 }}>{ENDINGS[id].icon}</span>
        <h3>{ENDINGS[id].name}</h3>
      </div>
      <ul className="goals">{items}</ul>
    </div>
  );

  return (
    <>
      <p className="muted small">
        ตัดสินตอนจบเมื่อครบ {state.maxTurn} เทิร์น โดยตรวจจากบนลงล่าง เข้าเงื่อนไขข้อไหนก่อนได้ตอนจบนั้น
      </p>
      {card('ashes', [item('', 'เสียกรุงนทีเมื่อไร เกมจบทันที')])}
      {card('shadow', [
        item(
          p.shadow.sovereignty < 40 ? 'hit' : '',
          `เอกราช ${p.shadow.sovereignty} (ต่ำกว่า 40 = เข้าเงื่อนไข)`,
        ),
        item(
          p.shadow.extremeTurns >= RULES.extremeLimit ? 'hit' : '',
          `เอียงสุดขั้ว ${p.shadow.extremeTurns} จาก ${RULES.extremeLimit} ฤดู`,
        ),
      ])}
      {card('empire', [
        item(ok(p.empire.captures >= 3), `ยึดเมืองด้วยกำลัง ${p.empire.captures} จาก 3`),
        item(
          ok(p.empire.cityShare >= 0.7),
          `ครองเมือง ${p.empire.cities} จาก ${p.empire.totalCities} (ต้องได้ 70%)`,
        ),
      ])}
      {card('river', [
        item(ok(p.river.sovereignty >= 80), `เอกราช ${p.river.sovereignty} จาก 80`),
        item(ok(Math.abs(p.river.meter) <= RULES.balancedZone), `แถบไผ่ ${p.river.meter} (อยู่ในช่วง ±25)`),
        item(ok(p.river.cities >= 3), `ครองเมือง ${p.river.cities} จาก 3`),
        item(ok(p.river.wealth >= 100), `ทรัพย์ ${p.river.wealth} จาก 100`),
      ])}
      {card('wisdom', [
        item(ok(p.wisdom.knowTotal >= 150), `ความรู้สะสม ${p.wisdom.knowTotal} จาก 150`),
        item(ok(p.wisdom.faithTotal >= 120), `ศรัทธาสะสม ${p.wisdom.faithTotal} จาก 120`),
        item(p.wisdom.battles <= 2 ? 'ok' : 'hit', `สู้รบ ${p.wisdom.battles} ครั้ง (ไม่เกิน 2)`),
      ])}
      {card('survive', [item('', 'ถ้าไม่เข้าเงื่อนไขใดเลย')])}
    </>
  );
}
