import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { CHAPTERS, armiesOf, capitalOf, createGame, earlyRattanakosinChapter } from '@siam/engine';
import type { ChapterDefinition } from '@siam/engine';
import { ME, useStore } from '../src/store';
import { Hud } from '../src/ui/Hud';
import { SidePanel } from '../src/ui/SidePanel';
import { Modals } from '../src/ui/Modals';

beforeEach(() => {
  useStore.getState().newGame(3);
  useStore.setState({ modals: [] });
});
afterEach(cleanup);

const select = (c: number, r: number) => act(() => useStore.getState().select(c, r));

describe('HUD', () => {
  it('shows the current season, turn and resources', () => {
    render(<Hud mode="light" onCycleTheme={() => {}} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('สยาม');
    expect(screen.getByText(/ปีที่ 1 จาก 10/)).toBeDefined();
    const chips = screen.getByText('ข้าว').closest('.chip')!;
    expect(within(chips).getByText('60')).toBeDefined();
  });
});

describe('side panel', () => {
  it('prompts the player to pick a tile, then shows the city', () => {
    render(<SidePanel />);
    expect(screen.getByText(/แตะช่องบนแผนที่/)).toBeDefined();
    const cap = capitalOf(useStore.getState().state, ME)!;
    select(cap.c, cap.r);
    expect(screen.getByRole('heading', { name: /กรุงนที/ })).toBeDefined();
    expect(screen.getByText('ยุ้งฉาง')).toBeDefined();
  });

  it('offers camp and found actions for the selected army', () => {
    render(<SidePanel />);
    const army = armiesOf(useStore.getState().state, ME)[0]!;
    select(army.c, army.r);
    expect(screen.getByRole('button', { name: /ตั้งค่ายพักพล/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /ตั้งเมืองใหม่/ })).toHaveProperty('disabled', true);
  });

  it('ends the season from the primary button', () => {
    render(<SidePanel />);
    act(() => screen.getByRole('button', { name: /จบฤดูฝน/ }).click());
    expect(useStore.getState().state.turn).toBe(2);
  });
});

describe('modals', () => {
  it('renders the great-power decision with three options', () => {
    act(() => {
      useStore.getState().dispatch({ type: 'endTurn' });
      useStore.getState().dispatch({ type: 'endTurn' });
    });
    const state = useStore.getState().state;
    useStore.setState({ modals: [] });
    expect(state.pending).toHaveLength(1);
    render(<Modals />);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('button', { name: /ยอมรับ/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /ต่อรอง/ })).toBeDefined();
    act(() => screen.getByRole('button', { name: /ปฏิเสธ/ }).click());
    expect(useStore.getState().state.pending.some((p) => p.kind === 'offer')).toBe(false);
  });
});

describe('chapter-driven UI (ADR-0007 Addendum 7)', () => {
  it("shows names and labels from the game's own chapter, not data.ts", () => {
    const chapter: ChapterDefinition = {
      ...earlyRattanakosinChapter,
      manifest: { ...earlyRattanakosinChapter.manifest, id: 'ui-test-chapter' },
      buildings: {
        ...earlyRattanakosinChapter.buildings,
        granary: { ...earlyRattanakosinChapter.buildings['granary']!, name: 'ยุ้งทดสอบ' },
      },
      resourceLabels: { ...earlyRattanakosinChapter.resourceLabels, rice: { name: 'ข้าวทดสอบ', icon: '🍙' } },
    };
    CHAPTERS[chapter.manifest.id] = chapter;
    try {
      act(() => useStore.setState({ state: createGame({ chapter, humans: [{ id: ME }], seed: 3 }) }));
      render(<Hud mode="light" onCycleTheme={() => {}} />);
      render(<SidePanel />);
      expect(screen.getByText('ข้าวทดสอบ')).toBeDefined();
      const cap = capitalOf(useStore.getState().state, ME)!;
      select(cap.c, cap.r);
      expect(screen.getByText('ยุ้งทดสอบ')).toBeDefined();
      expect(screen.queryByText('ยุ้งฉาง')).toBeNull();
    } finally {
      cleanup();
      delete CHAPTERS[chapter.manifest.id];
    }
  });
});
