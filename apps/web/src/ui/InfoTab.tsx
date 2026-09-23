import {
  armyAt,
  buildingDefenseMultiplier,
  atWar,
  canPay,
  cityAt,
  cityYield,
  faction,
  foundBlocker,
  isCoastal,
  isRiver,
  isSea,
  relation,
  seasonOf,
  terrainAt,
} from '@siam/engine';
import type { Army, BuildingId, City, Cost } from '@siam/engine';
import { ME, useStore } from '../store';
import { RES_ORDER, chapterOf, costText as costTextIn, seasonalCostOf } from './format';

function ArmyCard({ army }: { army: Army }) {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const mine = army.owner === ME;
  const owner = faction(state, army.owner);
  const season = seasonOf(state.turn);
  const chapter = chapterOf(state);
  const costText = (c: Cost) => costTextIn(c, chapter);
  const foundCost = seasonalCostOf(state, chapter.costs.found ?? {}, 'build');
  const blocker = foundBlocker(state, army);
  const me = state.factions[ME]!;
  return (
    <div className="card">
      <div className="ch">
        <span className="sw" style={{ background: `var(--own-${owner.colorToken})` }} />
        <h3>{mine ? 'ทัพของคุณ' : `ทัพ${owner.name}`}</h3>
      </div>
      <div className="kv">
        <span>กำลังพล</span>
        <b>{army.str}</b>
        <span>ขวัญกำลังใจ</span>
        <b>{army.morale}%</b>
        {mine && (
          <>
            <span>แต้มเดิน</span>
            <b>
              {army.mp} จาก {season.move}
            </b>
            <span>เสบียง</span>
            <b>🌾{Math.ceil(army.str / chapter.rules.upkeepPerStr)} ต่อฤดู</b>
          </>
        )}
      </div>
      {mine ? (
        <>
          <p className="hint">
            {army.mp > 0
              ? 'แตะช่องสว่างเพื่อเดินทัพ ช่องขอบแดงคือเป้าหมายที่โจมตีได้'
              : 'ทัพนี้เคลื่อนไหวครบแล้วในฤดูนี้'}
          </p>
          <div className="btns">
            <button
              className="btn"
              disabled={army.mp <= 0}
              onClick={() => dispatch({ type: 'camp', armyId: army.id })}
            >
              ⛺ ตั้งค่ายพักพล <small>ขวัญ +15</small>
            </button>
            <button
              className="btn"
              disabled={!!blocker || !canPay(me.res, foundCost)}
              onClick={() => dispatch({ type: 'found', armyId: army.id })}
            >
              🏯 ตั้งเมืองใหม่ที่นี่ <small>{costText(foundCost)}</small>
            </button>
          </div>
          {blocker && <p className="muted small">{blocker}</p>}
        </>
      ) : (
        <p className="muted">
          {atWar(state, army.owner, ME) ? '⚔️ อยู่ในภาวะสงครามกับคุณ' : '🕊️ ยังไม่มีสงครามกับคุณ'}
        </p>
      )}
    </div>
  );
}

function CityCard({ city }: { city: City }) {
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const me = state.factions[ME]!;
  const owner = faction(state, city.owner);
  const mine = city.owner === ME;
  const season = seasonOf(state.turn);
  const chapter = chapterOf(state);
  const R = chapter.rules;
  const costText = (c: Cost) => costTextIn(c, chapter);
  const yields = cityYield(city, chapter);
  const recruitCost = seasonalCostOf(state, chapter.costs.recruit ?? {}, 'recruit');
  const fortifications = buildingDefenseMultiplier(chapter, city.buildings).names;
  const garrisonArmy = armyAt(state, city.c, city.r);
  const coastal = isCoastal(city.c, city.r);
  return (
    <div className="card">
      <div className="ch">
        <span className="sw" style={{ background: `var(--own-${owner.colorToken})` }} />
        <h3>
          {city.name}
          {city.capital ? ' 👑' : ''}
        </h3>
      </div>
      <p className="muted small">
        {owner.name}, กองรักษาเมือง {city.garrison}
        {fortifications.length ? `, มี${fortifications.join('/')}` : ''}
      </p>
      {mine ? (
        <>
          <div className="yield">
            {RES_ORDER.map((k) => (
              <span key={k}>
                {chapter.resourceLabels[k].icon}
                {yields[k]}
              </span>
            ))}
            <small>ผลผลิตต่อฤดูก่อนปรับตามฤดูกาล</small>
          </div>
          <h4>สิ่งก่อสร้าง{season.build < 1 && <span className="good small"> ลดราคาในฤดูร้อน</span>}</h4>
          {(Object.keys(chapter.buildings) as BuildingId[])
            .filter((id) => !chapter.buildings[id]!.coastalOnly || coastal)
            .map((id) => {
              const def = chapter.buildings[id]!;
              const built = city.buildings.includes(id);
              const cost = seasonalCostOf(state, def.cost, 'build');
              return (
                <div className={`brow ${built ? 'done' : ''}`} key={id}>
                  <div>
                    <b>{def.name}</b>
                    <small>{def.desc}</small>
                  </div>
                  {built ? (
                    <span className="good small">✓ มีแล้ว</span>
                  ) : (
                    <button
                      className="btn sm"
                      disabled={!canPay(me.res, cost)}
                      onClick={() => dispatch({ type: 'build', cityId: city.id, building: id })}
                    >
                      {costText(cost)}
                    </button>
                  )}
                </div>
              );
            })}
          <h4>กองทัพ</h4>
          <button
            className="btn wide"
            disabled={!canPay(me.res, recruitCost) || (garrisonArmy?.str ?? 0) >= R.armyCap}
            onClick={() => dispatch({ type: 'recruit', cityId: city.id })}
          >
            {garrisonArmy ? `⚔️ เสริมทัพในเมือง +${R.recruitReinforce}` : `⚔️ เกณฑ์ทัพใหม่ (${R.recruitNew})`}{' '}
            <small>{costText(recruitCost)}</small>
          </button>
          {!coastal && <p className="muted small">ท่าเรือสร้างได้เฉพาะเมืองติดทะเล</p>}
        </>
      ) : (
        <>
          <p>
            ความสัมพันธ์ <b>{relation(state, city.owner, ME).rel}</b>
            {atWar(state, city.owner, ME) && <span className="badge bad"> สงคราม</span>}
          </p>
          <p className="muted small">ดูตัวเลือกการทูตได้ที่แท็บการทูต</p>
        </>
      )}
    </div>
  );
}

export function InfoTab() {
  const state = useStore((s) => s.state);
  const sel = useStore((s) => s.sel);
  if (!sel)
    return (
      <div className="empty">
        <p>
          <b>แตะช่องบนแผนที่</b> เพื่อดูข้อมูล
        </p>
        <p>
          แตะ <span className="dot" /> ทัพของคุณ แล้วแตะช่องสว่างเพื่อเดินทัพ
        </p>
        <p>แตะที่ตัวเมืองเพื่อก่อสร้างและเกณฑ์ทัพ</p>
        <p className="muted small">ลากแผนที่เพื่อเลื่อน ใช้ล้อเมาส์หรือสองนิ้วเพื่อซูม</p>
      </div>
    );
  const terrain = terrainAt(sel.c, sel.r);
  if (!terrain)
    return (
      <div className="card">
        <h3>{isSea(sel.c, sel.r) ? 'ทะเล' : 'นอกแผนที่'}</h3>
        {isSea(sel.c, sel.r) && (
          <p className="muted">เส้นทางของพ่อค้าและเรือมหาอำนาจ เมืองที่อยู่ติดทะเลสร้างท่าเรือได้</p>
        )}
      </div>
    );
  const army = armyAt(state, sel.c, sel.r);
  const city = cityAt(state, sel.c, sel.r);
  const chapter = chapterOf(state);
  const t = chapter.terrain[terrain]!;
  const river = isRiver(sel.c, sel.r);
  const riverBonus = RES_ORDER.filter((k) => chapter.rules.riverBonus[k])
    .map((k) => `${chapter.resourceLabels[k].icon}${chapter.rules.riverBonus[k]}`)
    .join(' ');
  return (
    <>
      {army && <ArmyCard army={army} />}
      {city && <CityCard city={city} />}
      <div className="card sub">
        <h3>
          {t.name}
          {river ? ' ริมแม่น้ำ' : ''}
        </h3>
        <p className="muted small">
          ใช้แต้มเดิน {t.cost}, พลังรับ ×{t.def}, ผลผลิต{' '}
          {RES_ORDER.filter((k) => t.yield[k])
            .map((k) => `${chapter.resourceLabels[k].icon}${t.yield[k]}`)
            .join(' ') || 'ไม่มี'}
          {river && riverBonus ? ` ${riverBonus}` : ''}
        </p>
      </div>
    </>
  );
}
