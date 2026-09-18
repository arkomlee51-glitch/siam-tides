import { seasonLabel } from '@siam/engine';
import { useStore } from '../store';

export function LogTab() {
  const log = useStore((s) => s.state.log);
  if (!log.length) return <p className="muted">ยังไม่มีบันทึก</p>;
  return (
    <ul className="logl">
      {[...log]
        .reverse()
        .slice(0, 80)
        .map((e, i) => (
          <li key={`${e.turn}-${i}`} className={e.tone}>
            <span className="t">{seasonLabel(e.turn)}</span>
            {e.text}
          </li>
        ))}
    </ul>
  );
}
