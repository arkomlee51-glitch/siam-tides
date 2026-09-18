import type { TerrainId } from '@siam/engine';

export type ThemeMode = 'auto' | 'light' | 'dark';

export interface Palette {
  bg: number;
  bg2: number;
  panel: number;
  ink: number;
  ink2: number;
  line: number;
  accent: number;
  accentInk: number;
  lac: number;
  good: number;
  bad: number;
  warn: number;
  river: number;
  hexLine: number;
  sea: number;
  sea2: number;
  terrain: Record<TerrainId, number>;
  own: Record<string, number>;
}

export const LIGHT: Palette = {
  bg: 0xe6ebe0,
  bg2: 0xd9e1d2,
  panel: 0xf4f6ef,
  ink: 0x1f2a4a,
  ink2: 0x56607a,
  line: 0xbcc7b6,
  accent: 0xc98a12,
  accentInk: 0x1f2a4a,
  lac: 0xa8322d,
  good: 0x2f7a45,
  bad: 0xb0312a,
  warn: 0xb77a0c,
  river: 0x3f78a3,
  hexLine: 0xffffff,
  sea: 0x8fb3c4,
  sea2: 0x83a9bb,
  terrain: { C: 0xb9cf8c, K: 0xd6c486, L: 0x86ad7c, S: 0xc3d79c, M: 0x8b9270 },
  own: { player: 0xa8322d, north: 0x34478e, east: 0x2a7a6a, south: 0xb4661c },
};

export const DARK: Palette = {
  bg: 0x10162b,
  bg2: 0x161e38,
  panel: 0x1b2442,
  ink: 0xe9e4d2,
  ink2: 0x9aa2bb,
  line: 0x2d3860,
  accent: 0xe7b43c,
  accentInk: 0x10162b,
  lac: 0xe2644f,
  good: 0x5cc47a,
  bad: 0xef6a5a,
  warn: 0xe7b43c,
  river: 0x6aa6d6,
  hexLine: 0x000000,
  sea: 0x1f3752,
  sea2: 0x1b3149,
  terrain: { C: 0x587648, K: 0x7a6a42, L: 0x3f6547, S: 0x647c4b, M: 0x4a4e3e },
  own: { player: 0xec6a55, north: 0x8aa0ee, east: 0x52c2a8, south: 0xe69a4a },
};

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** The renderer reads numbers, the DOM reads these variables — both from one palette. */
export function cssVars(p: Palette): Record<string, string> {
  const vars: Record<string, string> = {
    '--bg': hex(p.bg),
    '--bg2': hex(p.bg2),
    '--panel': hex(p.panel),
    '--ink': hex(p.ink),
    '--ink2': hex(p.ink2),
    '--line': hex(p.line),
    '--accent': hex(p.accent),
    '--accent-ink': hex(p.accentInk),
    '--lac': hex(p.lac),
    '--good': hex(p.good),
    '--bad': hex(p.bad),
    '--warn': hex(p.warn),
    '--river': hex(p.river),
  };
  for (const [k, v] of Object.entries(p.own)) vars[`--own-${k}`] = hex(v);
  return vars;
}

export function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}

export function paletteFor(mode: ThemeMode): Palette {
  return resolveMode(mode) === 'dark' ? DARK : LIGHT;
}

export function applyTheme(mode: ThemeMode): Palette {
  const p = paletteFor(mode);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(cssVars(p))) root.style.setProperty(k, v);
  root.dataset.theme = resolveMode(mode);
  return p;
}
