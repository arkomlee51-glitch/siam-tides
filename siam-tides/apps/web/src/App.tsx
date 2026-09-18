import { useEffect, useState } from 'react';
import { faction } from '@siam/engine';
import { ME, useStore } from './store';
import { applyTheme } from './theme';
import type { ThemeMode } from './theme';
import { Hud } from './ui/Hud';
import { MapCanvas } from './ui/MapCanvas';
import { Modals } from './ui/Modals';
import { SidePanel } from './ui/SidePanel';
import { Toast } from './ui/Toast';

const THEME_KEY = 'siam-theme';
const MODES: ThemeMode[] = ['auto', 'light', 'dark'];

export function App() {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? 'auto',
  );
  const hydrate = useStore((s) => s.hydrate);
  const state = useStore((s) => s.state);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    applyTheme(mode);
    localStorage.setItem(THEME_KEY, mode);
    if (mode !== 'auto') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('auto');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const cycleTheme = () => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]!);

  return (
    <>
      <Hud mode={mode} onCycleTheme={cycleTheme} />
      <main className="layout">
        <section>
          <MapCanvas mode={mode} />
          <div className="legend">
            {state.order.map((id) => {
              const f = faction(state, id);
              return (
                <span key={id} className={f.alive ? '' : 'gone'}>
                  <i className="sw" style={{ background: `var(--own-${f.colorToken})` }} />
                  {id === ME ? 'อาณาจักรของคุณ' : f.name}
                </span>
              );
            })}
            <span>
              <i className="sw" style={{ background: 'var(--river)' }} />
              แม่น้ำ
            </span>
            <span>ตัวเลขในวงกลมคือกำลังพล</span>
          </div>
        </section>
        <SidePanel />
      </main>
      <Modals />
      <Toast />
    </>
  );
}
