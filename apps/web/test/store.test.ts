import { beforeEach, describe, expect, it } from 'vitest';
import { armiesOf, capitalOf, relation } from '@siam/engine';
import { ME, selectionOverlay, useStore } from '../src/store';

const reset = () => useStore.getState().newGame(7);

describe('store', () => {
  beforeEach(reset);

  it('starts a fresh game with the intro modal', () => {
    const s = useStore.getState();
    expect(s.state.turn).toBe(1);
    expect(s.modals[0]?.kind).toBe('intro');
    expect(s.state.factions[ME]!.kind).toBe('human');
  });

  it('moves the selected army when a reachable tile is clicked', () => {
    const army = armiesOf(useStore.getState().state, ME)[0]!;
    useStore.getState().select(army.c, army.r);
    const dest = selectionOverlay(useStore.getState()).reach[0]!;
    useStore.getState().clickTile(dest.c, dest.r);
    const moved = armiesOf(useStore.getState().state, ME)[0]!;
    expect([moved.c, moved.r]).toEqual([dest.c, dest.r]);
    expect(useStore.getState().sel).toEqual({ c: dest.c, r: dest.r });
  });

  it('rejects illegal commands with a toast and no state change', () => {
    const before = useStore.getState().state;
    const ok = useStore.getState().dispatch({ type: 'annex', target: 'north' });
    expect(ok).toBe(false);
    expect(useStore.getState().state).toBe(before);
    expect(useStore.getState().toast).toContain('ความสัมพันธ์');
  });

  it('queues a season report when the turn resolves', () => {
    useStore.setState({ modals: [] });
    useStore.getState().dispatch({ type: 'endTurn' });
    const modal = useStore.getState().modals[0];
    expect(modal?.kind).toBe('season');
    if (modal?.kind === 'season') expect(modal.turn).toBe(2);
  });

  it('queues a battle report for the player’s own attack', () => {
    useStore.setState({ modals: [] });
    const state = structuredClone(useStore.getState().state);
    const army = armiesOf(state, ME)[0]!;
    army.c = 8;
    army.r = 4;
    relation(state, ME, 'east').war = true;
    useStore.setState({ state, sel: { c: 8, r: 4 } });
    useStore.getState().clickTile(9, 4);
    const modal = useStore.getState().modals[0];
    expect(modal?.kind).toBe('battle');
    if (modal?.kind === 'battle') expect(modal.report.attacker).toBe(ME);
  });

  it('warns instead of attacking when there is no war', () => {
    const state = structuredClone(useStore.getState().state);
    const army = armiesOf(state, ME)[0]!;
    army.c = 8;
    army.r = 4;
    useStore.setState({ state, sel: { c: 8, r: 4 }, modals: [] });
    useStore.getState().clickTile(9, 4);
    expect(useStore.getState().toast).toContain('สงคราม');
    expect(useStore.getState().modals).toHaveLength(0);
  });

  it('confirms a war declaration through the confirm modal', () => {
    useStore.setState({ modals: [] });
    useStore.getState().pushModal({
      kind: 'confirm',
      title: 'x',
      body: 'y',
      confirmLabel: 'go',
      action: { type: 'declareWar', target: 'south' },
    });
    useStore.getState().confirmModal();
    expect(relation(useStore.getState().state, ME, 'south').war).toBe(true);
  });

  it('keeps the capital selectable for building', () => {
    const cap = capitalOf(useStore.getState().state, ME)!;
    useStore.getState().dispatch({ type: 'build', cityId: cap.id, building: 'granary' });
    expect(capitalOf(useStore.getState().state, ME)!.buildings).toContain('granary');
  });
});
