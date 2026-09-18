import { seasonOf } from '@siam/engine';
import { useStore } from '../store';
import type { Tab } from '../store';
import { BambooTab } from './BambooTab';
import { DiplomacyTab } from './DiplomacyTab';
import { GoalsTab } from './GoalsTab';
import { InfoTab } from './InfoTab';
import { LogTab } from './LogTab';
import { Meters } from './Meters';

const TABS: [Tab, string][] = [
  ['info', 'ข้อมูล'],
  ['diplo', 'การทูต'],
  ['bamboo', 'ไผ่ลู่ลม'],
  ['goals', 'เป้าหมาย'],
  ['log', 'บันทึก'],
];

export function SidePanel() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const state = useStore((s) => s.state);
  const dispatch = useStore((s) => s.dispatch);
  const Pane = { info: InfoTab, diplo: DiplomacyTab, bamboo: BambooTab, goals: GoalsTab, log: LogTab }[tab];

  return (
    <aside className="side">
      <div>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="pane">
          <Pane />
        </div>
      </div>
      <Meters />
      <button className="btn primary" disabled={state.ended} onClick={() => dispatch({ type: 'endTurn' })}>
        {state.ended ? 'จบเกมแล้ว' : `จบ${seasonOf(state.turn).name}`}
      </button>
    </aside>
  );
}
