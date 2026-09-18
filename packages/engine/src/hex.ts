import { MAP, RIVER, TERRAIN } from './data.js';
import type { Coord, TerrainId } from './types.js';

export const HEX_SIZE = 26;
export const SQRT3 = Math.sqrt(3);
export const ROWS = MAP.length;
export const COLS = MAP[0]?.length ?? 0;

export const key = (c: number, r: number): string => `${c},${r}`;
export function parseKey(k: string): [number, number] {
  const [c, r] = k.split(',').map(Number);
  return [c ?? 0, r ?? 0];
}

export function tileAt(c: number, r: number): string {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return '.';
  return MAP[r]?.[c] ?? '.';
}
export function terrainAt(c: number, r: number): TerrainId | null {
  const t = tileAt(c, r);
  return Object.hasOwn(TERRAIN, t) ? (t as TerrainId) : null;
}
export const isSea = (c: number, r: number): boolean => tileAt(c, r) === '~';
export const isLand = (c: number, r: number): boolean => terrainAt(c, r) !== null;

/** Direction order: E, NE, NW, W, SW, SE (matches EDGE_CORNERS). */
const NB_EVEN: readonly Coord[] = [
  [1, 0],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const NB_ODD: readonly Coord[] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
];
/** For direction i, the pair of corner indices forming the shared edge (pointy-top, y down). */
export const EDGE_CORNERS: readonly Coord[] = [
  [5, 0],
  [4, 5],
  [3, 4],
  [2, 3],
  [1, 2],
  [0, 1],
];

export function neighbors(c: number, r: number): [number, number][] {
  return (r & 1 ? NB_ODD : NB_EVEN).map(([dc, dr]) => [c + dc, r + dr]);
}

function toCube(c: number, r: number): [number, number, number] {
  const x = c - (r - (r & 1)) / 2;
  return [x, -x - r, r];
}
export function hexDistance(a: Coord, b: Coord): number {
  const A = toCube(a[0], a[1]);
  const B = toCube(b[0], b[1]);
  return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
}

export function hexCenter(c: number, r: number, size = HEX_SIZE): [number, number] {
  return [SQRT3 * size * (c + 0.5 * (r & 1)), 1.5 * size * r];
}
export function hexCorners(cx: number, cy: number, size = HEX_SIZE): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i + 30);
    out.push([cx + size * Math.cos(a), cy + size * Math.sin(a)]);
  }
  return out;
}
/** Pixel pos → offset coord (for pointer picking in the renderer). */
export function pixelToHex(x: number, y: number, size = HEX_SIZE): [number, number] {
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
  const rr = ((2 / 3) * y) / size;
  const cx = q,
    cz = rr,
    cy = -cx - cz;
  let rx = Math.round(cx),
    ry = Math.round(cy),
    rz = Math.round(cz);
  const dx = Math.abs(rx - cx),
    dy = Math.abs(ry - cy),
    dz = Math.abs(rz - cz);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  void ry;
  return [(rx + (rz - (rz & 1)) / 2) | 0, rz | 0];
}
export function mapPixelBounds(size = HEX_SIZE): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  return {
    minX: (-SQRT3 * size) / 2,
    minY: -size,
    width: SQRT3 * size * COLS + (SQRT3 * size) / 2,
    height: 1.5 * size * (ROWS - 1) + 2 * size,
  };
}

const riverSet = new Set(RIVER.slice(0, -1).map(([c, r]) => key(c, r)));
export const isRiver = (c: number, r: number): boolean => riverSet.has(key(c, r));
export const isCoastal = (c: number, r: number): boolean => neighbors(c, r).some(([a, b]) => isSea(a, b));

/** All land tiles within `radius` of (c, r). */
export function tilesWithin(c: number, r: number, radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let rr = r - radius; rr <= r + radius; rr++)
    for (let cc = c - radius - 1; cc <= c + radius + 1; cc++)
      if (isLand(cc, rr) && hexDistance([cc, rr], [c, r]) <= radius) out.push([cc, rr]);
  return out;
}
