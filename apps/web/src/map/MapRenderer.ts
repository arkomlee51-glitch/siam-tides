import { Application, Container, Graphics, Text } from 'pixi.js';
import { HEX_SIZE, RIVER, atWar, cityAt, faction, hexCenter, mapPixelBounds, pixelToHex } from '@siam/engine';
import type { FactionId, GameState } from '@siam/engine';
import type { Palette } from '../theme';
import {
  RIVER_WIDTH,
  cityArea,
  cityIcon,
  decorations,
  hexPolygon,
  mapShapes,
  territoryEdges,
} from './geometry';

export interface MapSelection {
  sel: { c: number; r: number } | null;
  reach: { c: number; r: number }[];
  attack: { c: number; r: number }[];
}

const LABEL_STYLE = {
  fontFamily: 'Sarabun, sans-serif',
  fontSize: 12,
  fontWeight: '700' as const,
};

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.6;
const DRAG_THRESHOLD = 6;

/**
 * Owns the Pixi application. React never touches display objects directly:
 * it calls setPalette / draw and listens for tile clicks.
 */
export class MapRenderer {
  private app = new Application();
  private world = new Container();
  private terrain = new Container();
  private territory = new Container();
  private highlight = new Container();
  private units = new Container();
  private palette: Palette;
  private onTile: (c: number, r: number) => void = () => {};
  private pointers = new Map<number, { x: number; y: number }>();
  private dragged = 0;
  private pinchStart: { dist: number; scale: number } | null = null;
  private ready = false;

  constructor(palette: Palette) {
    this.palette = palette;
  }

  async init(canvas: HTMLCanvasElement, host: HTMLElement): Promise<void> {
    await this.app.init({
      canvas,
      resizeTo: host,
      antialias: true,
      backgroundAlpha: 0,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
    });
    this.ready = true;
    this.world.addChild(this.terrain, this.territory, this.highlight, this.units);
    this.app.stage.addChild(this.world);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.bindInput(canvas);
    this.drawTerrain();
    this.fit();
  }

  setTileClickHandler(fn: (c: number, r: number) => void): void {
    this.onTile = fn;
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    if (this.ready) this.drawTerrain();
  }

  destroy(): void {
    if (!this.ready) return;
    this.ready = false;
    this.app.destroy(true, { children: true });
  }

  /** Centre the map and scale it to fit the viewport. */
  fit(): void {
    if (!this.ready) return;
    const b = mapPixelBounds();
    const pad = 16;
    const scale = Math.min(
      (this.app.screen.width - pad) / b.width,
      (this.app.screen.height - pad) / b.height,
    );
    const s = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    this.world.scale.set(s);
    this.world.position.set(
      (this.app.screen.width - b.width * s) / 2 - b.minX * s,
      (this.app.screen.height - b.height * s) / 2 - b.minY * s,
    );
  }

  zoomBy(factor: number, cx?: number, cy?: number): void {
    if (!this.ready) return;
    const before = this.world.scale.x;
    const after = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, before * factor));
    if (after === before) return;
    const px = cx ?? this.app.screen.width / 2;
    const py = cy ?? this.app.screen.height / 2;
    const k = after / before;
    this.world.scale.set(after);
    this.world.position.set(px - (px - this.world.position.x) * k, py - (py - this.world.position.y) * k);
  }

  /* ---------------- drawing ---------------- */

  private drawTerrain(): void {
    this.terrain.removeChildren().forEach((c) => c.destroy());
    const p = this.palette;
    const tiles = new Graphics();
    const deco = new Graphics();
    for (const shape of mapShapes()) {
      const color = shape.kind === 'sea' ? (shape.shade ? p.sea : p.sea2) : p.terrain[shape.kind];
      tiles.poly(shape.points).fill({ color }).stroke({ width: 1, color: p.hexLine, alpha: 0.35 });
      for (const line of decorations(shape)) {
        deco.moveTo(line[0]!, line[1]!);
        for (let i = 2; i < line.length; i += 2) deco.lineTo(line[i]!, line[i + 1]!);
        deco.stroke({ width: 1.3, color: p.ink, alpha: shape.kind === 'sea' ? 0.25 : 0.22 });
      }
    }
    const river = new Graphics();
    const pts = RIVER.map(([c, r]) => hexCenter(c, r));
    river.moveTo(pts[0]![0], pts[0]![1]);
    for (const [x, y] of pts.slice(1)) river.lineTo(x, y);
    river.stroke({ width: RIVER_WIDTH, color: p.river, alpha: 0.85, cap: 'round', join: 'round' });
    this.terrain.addChild(tiles, deco, river);
  }

  /** Redraw everything that depends on game state. Cheap enough to run on every change. */
  draw(state: GameState, me: FactionId, selection: MapSelection): void {
    if (!this.ready) return;
    const p = this.palette;

    this.territory.removeChildren().forEach((c) => c.destroy());
    const areas = new Graphics();
    for (const city of state.cities) {
      const color = p.own[faction(state, city.owner).colorToken] ?? p.lac;
      for (const [c, r] of cityArea(city, 2)) {
        const own = cityArea(city, 1).some(([a, b]) => a === c && b === r);
        areas.poly(hexPolygon(c, r, HEX_SIZE, 1)).fill({ color, alpha: own ? 0.3 : 0.09 });
      }
      for (const e of territoryEdges(city)) {
        areas.moveTo(e.x1, e.y1).lineTo(e.x2, e.y2).stroke({ width: 2.6, color, alpha: 0.95, cap: 'round' });
      }
    }
    this.territory.addChild(areas);

    this.highlight.removeChildren().forEach((c) => c.destroy());
    const hi = new Graphics();
    for (const t of selection.reach) {
      hi.poly(hexPolygon(t.c, t.r, HEX_SIZE, 2)).fill({ color: p.panel, alpha: 0.42 });
      const [x, y] = hexCenter(t.c, t.r);
      hi.circle(x, y, 2.5).fill({ color: p.ink, alpha: 0.5 });
    }
    for (const t of selection.attack) {
      hi.poly(hexPolygon(t.c, t.r, HEX_SIZE, 2.5))
        .fill({ color: p.bad, alpha: 0.18 })
        .stroke({ width: 2.5, color: p.bad });
    }
    if (selection.sel) {
      hi.poly(hexPolygon(selection.sel.c, selection.sel.r, HEX_SIZE, 1)).stroke({
        width: 3.5,
        color: p.accent,
      });
    }
    this.highlight.addChild(hi);

    this.units.removeChildren().forEach((c) => c.destroy());
    const marks = new Graphics();
    for (const city of state.cities) {
      const color = p.own[faction(state, city.owner).colorToken] ?? p.lac;
      const [x, y] = hexCenter(city.c, city.r);
      marks.poly(cityIcon(x, y)).fill({ color }).stroke({ width: 1.4, color: p.panel });
      if (city.buildings.includes('walls')) {
        marks
          .moveTo(x - 11, y + 8)
          .lineTo(x - 11, y + 4)
          .lineTo(x + 11, y + 4)
          .lineTo(x + 11, y + 8)
          .stroke({ width: 1.6, color });
      }
      if (city.capital)
        marks
          .circle(x, y - 13, 2.6)
          .fill({ color: p.accent })
          .stroke({ width: 1, color: p.panel });
      const label = new Text({
        text: city.name,
        style: { ...LABEL_STYLE, fill: p.ink, stroke: { color: p.panel, width: 3 } },
      });
      label.anchor.set(0.5, 0);
      label.position.set(x, y + 13);
      this.units.addChild(label);
    }
    for (const army of state.armies) {
      const f = faction(state, army.owner);
      const color = p.own[f.colorToken] ?? p.lac;
      const [cx, cy] = hexCenter(army.c, army.r);
      const onCity = !!cityAt(state, army.c, army.r);
      const x = onCity ? cx + 10 : cx;
      const y = onCity ? cy - 10 : cy;
      marks.circle(x, y, 11).fill({ color }).stroke({ width: 2, color: p.panel });
      if (army.owner === me && army.mp > 0 && !state.ended) {
        marks.circle(x, y, 14.5).stroke({ width: 2, color, alpha: 0.7 });
      }
      if (army.owner !== me && atWar(state, army.owner, me)) {
        marks
          .circle(x + 9, y - 9, 4)
          .fill({ color: p.bad })
          .stroke({ width: 1, color: p.panel });
      }
      const strength = new Text({
        text: String(army.str),
        style: { ...LABEL_STYLE, fontSize: 11, fill: 0xffffff },
      });
      strength.anchor.set(0.5);
      strength.position.set(x, y);
      this.units.addChild(strength);
    }
    this.units.addChildAt(marks, 0);
  }

  /* ---------------- input ---------------- */

  private bindInput(canvas: HTMLCanvasElement): void {
    const stage = this.app.stage;
    stage.on('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      this.dragged = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: this.world.scale.x };
      }
    });
    stage.on('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.global.x - prev.x;
      const dy = e.global.y - prev.y;
      this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      this.dragged += Math.hypot(dx, dy);
      if (this.pointers.size === 1) {
        this.world.position.set(this.world.position.x + dx, this.world.position.y + dy);
      } else if (this.pointers.size === 2 && this.pinchStart) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const target = (this.pinchStart.scale * dist) / this.pinchStart.dist;
        this.zoomBy(target / this.world.scale.x, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      }
    });
    const release = (e: { pointerId: number; global: { x: number; y: number } }) => {
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchStart = null;
      if (!wasSingle || this.dragged > DRAG_THRESHOLD) return;
      const local = this.world.toLocal({ x: e.global.x, y: e.global.y });
      const [c, r] = pixelToHex(local.x, local.y);
      this.onTile(c, r);
    };
    stage.on('pointerup', release);
    stage.on('pointerupoutside', release);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false },
    );
  }
}
