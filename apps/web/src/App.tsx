import { useState } from 'react';
import { ENGINE_VERSION, applyAction, createGame, seasonLabel } from '@siam/engine';
import type { GameState } from '@siam/engine';

/** Phase 0 placeholder — proves the web app runs the shared engine. Phase 2 replaces it. */
export function App() {
  const [state, setState] = useState<GameState>(() => createGame({ seed: 1 }));
  const me = state.factions.p1!;
  const endTurn = () => {
    const pending = state.pending.find((p) => p.faction === 'p1');
    const res = pending
      ? applyAction(state, 'p1', { type: 'answerDecision', decisionId: pending.id, choice: 'decline' })
      : applyAction(state, 'p1', { type: 'endTurn' });
    if (res.ok) setState(res.state);
  };
  return (
    <main style={{ fontFamily: 'Sarabun, system-ui, sans-serif', padding: 24, maxWidth: 640 }}>
      <h1>สยาม: กระแสแห่งราชอาณาจักร</h1>
      <p>
        engine {ENGINE_VERSION} · {seasonLabel(state.turn)}
      </p>
      <p>
        ข้าว {me.res.rice} ทรัพย์ {me.res.wealth} ความรู้ {me.res.know}
      </p>
      <button onClick={endTurn} disabled={state.ended}>
        {state.ended ? `จบเกม: ${me.ending}` : 'จบฤดู'}
      </button>
      <p style={{ opacity: 0.7 }}>หน้านี้เป็นตัวยึดของเฟส 0 เฟส 2 จะแทนที่ด้วยแผนที่ PixiJS และ UI เต็ม</p>
    </main>
  );
}
