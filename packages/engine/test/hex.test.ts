import { describe, expect, it } from 'vitest';
import {
  COLS,
  ROWS,
  hexCenter,
  hexDistance,
  isCoastal,
  isLand,
  key,
  neighbors,
  pixelToHex,
  terrainAt,
} from '../src/index.js';

describe('hex grid', () => {
  it('neighbors are all at distance 1 and symmetric', () => {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        for (const [nc, nr] of neighbors(c, r)) {
          expect(hexDistance([c, r], [nc, nr])).toBe(1);
          expect(neighbors(nc, nr).some(([a, b]) => a === c && b === r)).toBe(true);
        }
  });

  it('pixelToHex inverts hexCenter', () => {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const [x, y] = hexCenter(c, r);
        expect(pixelToHex(x + 3, y - 2)).toEqual([c, r]);
      }
  });

  it('every land tile is reachable from the central capital', () => {
    const seen = new Set([key(5, 7)]);
    const queue: [number, number][] = [[5, 7]];
    while (queue.length) {
      const [c, r] = queue.shift()!;
      for (const [nc, nr] of neighbors(c, r))
        if (isLand(nc, nr) && !seen.has(key(nc, nr))) {
          seen.add(key(nc, nr));
          queue.push([nc, nr]);
        }
    }
    let land = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isLand(c, r)) land++;
    expect(seen.size).toBe(land);
  });

  it('knows terrain and coasts', () => {
    expect(terrainAt(5, 7)).toBe('C');
    expect(terrainAt(8, 9)).toBeNull();
    expect(isCoastal(4, 14)).toBe(true);
    expect(isCoastal(5, 7)).toBe(false);
  });
});
