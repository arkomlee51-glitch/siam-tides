import { PERKS } from '@siam/engine';
import { ME, useStore } from '../store';

export function Meters() {
  const me = useStore((s) => s.state.factions[ME]!);
  const next = PERKS.find((p) => !me.perks.includes(p.id));
  const bar = (label: string, value: number, bad: boolean) => (
    <div className="mrow" key={label}>
      <span>{label}</span>
      <div className={`mbar ${bad ? 'bad' : ''}`}>
        <i style={{ width: `${value}%` }} />
      </div>
      <b>{value}</b>
    </div>
  );
  return (
    <div className="meters">
      {bar('เสถียรภาพ', me.stability, me.stability < 25)}
      {bar('เอกราช', me.sovereignty, me.sovereignty < 40)}
      <div className="small">
        📜 ความรู้สะสม <b>{me.knowTotal}</b>
        {next ? `, วิทยาการถัดไปคือ${next.name}ที่ ${next.at}` : ''}
      </div>
      {me.perks.length > 0 && (
        <div className="perks">
          {me.perks.map((id) => (
            <span className="tag" key={id}>
              {PERKS.find((p) => p.id === id)!.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
