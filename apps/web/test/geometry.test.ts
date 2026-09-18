import { describe, expect, it } from 'vitest';
import { HEX_SIZE, hexCenter, isLand } from '@siam/engine';
import { cityArea, cityIcon, decorations, hexPolygon, mapShapes, territoryEdges } from '../src/map/geometry';

describe('map geometry', () => {
  it('builds one shape per land or sea tile', () => {
    const shapes = mapShapes();
    expect(shapes.length).toBeGreaterThan(150);
    for (const s of shapes) {
      expect(s.points).toHaveLength(12);
      expect(s.points.every(Number.isFinite)).toBe(true);
      expect(s.center).toEqual(hexCenter(s.c, s.r, HEX_SIZE));
    }
  });

  it('shrinks polygons without moving their centre', () => {
    const big = hexPolygon(5, 7);
    const small = hexPolygon(5, 7, HEX_SIZE, 4);
    const avg = (p: number[], i: number) => p.filter((_, k) => k % 2 === i).reduce((a, b) => a + b, 0) / 6;
    expect(avg(small, 0)).toBeCloseTo(avg(big, 0), 6);
    expect(avg(small, 1)).toBeCloseTo(avg(big, 1), 6);
  });

  it('outlines only the border of a city area', () => {
    const city = {
      id: 'c0',
      name: 'กรุงนที',
      c: 5,
      r: 7,
      owner: 'p1',
      capital: true,
      buildings: [],
      garrison: 30,
      baseGarrison: 30,
    } as const;
    const edges = territoryEdges({ ...city, buildings: [] });
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.length).toBeLessThanOrEqual(7 * 6);
    expect(edges.every((e) => [e.x1, e.y1, e.x2, e.y2].every(Number.isFinite))).toBe(true);
    expect(cityArea({ ...city, buildings: [] }, 1).every(([c, r]) => isLand(c, r))).toBe(true);
    expect(cityArea({ ...city, buildings: [] }, 2).length).toBeGreaterThan(
      cityArea({ ...city, buildings: [] }, 1).length,
    );
  });

  it('gives every terrain a decoration and closes the city icon', () => {
    for (const shape of mapShapes().slice(0, 40)) {
      for (const line of decorations(shape)) expect(line.length % 2).toBe(0);
    }
    expect(cityIcon(0, 0)).toHaveLength(16);
  });
});
