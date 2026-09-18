import {
  COLS,
  EDGE_CORNERS,
  HEX_SIZE,
  ROWS,
  hexCenter,
  hexCorners,
  hexDistance,
  isLand,
  isSea,
  neighbors,
  terrainAt,
} from '@siam/engine';
import type { City, TerrainId } from '@siam/engine';

export interface HexShape {
  c: number;
  r: number;
  /** 'sea' for water, otherwise the terrain id */
  kind: TerrainId | 'sea';
  /** flat [x0,y0,x1,y1,...] polygon */
  points: number[];
  center: [number, number];
  /** alternating water shade, so the sea isn't a flat slab */
  shade: boolean;
}

export const hexPolygon = (c: number, r: number, size = HEX_SIZE, shrink = 0): number[] => {
  const [x, y] = hexCenter(c, r, size);
  return hexCorners(x, y, size - shrink).flat();
};

/** Every drawable tile of the map, built once. */
export function mapShapes(size = HEX_SIZE): HexShape[] {
  const out: HexShape[] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const t = terrainAt(c, r);
      const land = t !== null;
      const sea = !land && isSea(c, r);
      if (!land && !sea) continue;
      out.push({
        c,
        r,
        kind: land ? t : 'sea',
        points: hexPolygon(c, r, size),
        center: hexCenter(c, r, size),
        shade: (c + r) % 2 === 0,
      });
    }
  return out;
}
/** Small decorative strokes per terrain (rice rows, hills, dunes...). */
export function decorations(shape: HexShape): number[][] {
  const [x, y] = shape.center;
  const P = (...pairs: number[]) => pairs.map((v, i) => (i % 2 === 0 ? x + v : y + v));
  switch (shape.kind) {
    case 'M':
      return [P(-11, 7, -3, -7, 4, 7), P(0, 7, 6, -2, 12, 7)];
    case 'L':
      return [P(-10, 5, -6, -2, -2, 5), P(0, 3, 5, -3, 10, 3)];
    case 'K':
      return [P(-6, -3, -5, -3), P(3, 2, 4, 2), P(7, -5, 8, -5), P(-2, 6, -1, 6)];
    case 'C':
      return [P(-9, -3, -2, -3), P(2, -3, 9, -3), P(-6, 3, 1, 3), P(4, 3, 9, 3)];
    case 'S':
      return [P(0, 7, 0, -3), P(0, -3, -8, -1), P(0, -3, 8, -1)];
    case 'sea':
      return (shape.c * 3 + shape.r) % 4 === 0 ? [P(-8, 0, -4, -3, 0, 0, 4, -3, 8, 0)] : [];
    default:
      return [];
  }
}

export interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Outline of a city's owned area (tiles within distance 1). */
export function territoryEdges(city: City, size = HEX_SIZE): Edge[] {
  const out: Edge[] = [];
  for (const [c, r] of [[city.c, city.r] as [number, number], ...neighbors(city.c, city.r)]) {
    if (!isLand(c, r)) continue;
    const [x, y] = hexCenter(c, r, size);
    const corners = hexCorners(x, y, size - 1.5);
    neighbors(c, r).forEach(([nc, nr], i) => {
      if (hexDistance([nc, nr], [city.c, city.r]) <= 1 && isLand(nc, nr)) return;
      const [a, b] = EDGE_CORNERS[i]!;
      const p1 = corners[a]!;
      const p2 = corners[b]!;
      out.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
    });
  }
  return out;
}

/** Tiles a city owns (yields) and merely influences. */
export function cityArea(city: City, radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = city.r - radius; r <= city.r + radius; r++)
    for (let c = city.c - radius - 1; c <= city.c + radius + 1; c++)
      if (isLand(c, r) && hexDistance([c, r], [city.c, city.r]) <= radius) out.push([c, r]);
  return out;
}

/** Stupa-ish city marker. */
export function cityIcon(x: number, y: number): number[] {
  return [
    x - 8,
    y + 8,
    x + 8,
    y + 8,
    x + 6,
    y + 1,
    x + 3.5,
    y + 1,
    x + 1.2,
    y - 10,
    x - 1.2,
    y - 10,
    x - 3.5,
    y + 1,
    x - 6,
    y + 1,
  ];
}

export const RIVER_WIDTH = 5;
