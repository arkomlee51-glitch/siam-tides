import { useEffect, useRef } from 'react';
import { useStore, ME, selectionOverlay } from '../store';
import { applyTheme } from '../theme';
import type { ThemeMode } from '../theme';
import { MapRenderer } from '../map/MapRenderer';

export function MapCanvas({ mode }: { mode: ThemeMode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const state = useStore((s) => s.state);
  const sel = useStore((s) => s.sel);
  const clickTile = useStore((s) => s.clickTile);

  useEffect(() => {
    let renderer: MapRenderer | null = null;
    let cancelled = false;
    const palette = applyTheme(mode);
    if (canvasRef.current && hostRef.current) {
      renderer = new MapRenderer(palette);
      void renderer.init(canvasRef.current, hostRef.current).then(() => {
        if (cancelled || !renderer) return;
        rendererRef.current = renderer;
        renderer.setTileClickHandler((c, r) => useStore.getState().clickTile(c, r));
        const store = useStore.getState();
        renderer.draw(store.state, ME, selectionOverlay(store));
      });
    }
    return () => {
      cancelled = true;
      rendererRef.current = null;
      renderer?.destroy();
    };
    // the renderer pulls the latest store state itself, so only the palette matters here
  }, [mode]);

  useEffect(() => {
    rendererRef.current?.setPalette(applyTheme(mode));
  }, [mode]);

  useEffect(() => {
    const store = useStore.getState();
    rendererRef.current?.draw(store.state, ME, selectionOverlay(store));
  }, [state, sel, clickTile]);

  return (
    <div className="map-host" ref={hostRef}>
      <canvas ref={canvasRef} />
      <div className="map-tools">
        <button className="btn icon" onClick={() => rendererRef.current?.zoomBy(1.2)} aria-label="ซูมเข้า">
          ＋
        </button>
        <button className="btn icon" onClick={() => rendererRef.current?.zoomBy(1 / 1.2)} aria-label="ซูมออก">
          －
        </button>
        <button className="btn icon" onClick={() => rendererRef.current?.fit()}>
          พอดีจอ
        </button>
      </div>
    </div>
  );
}
