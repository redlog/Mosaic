import { describe, expect, it } from 'vitest';
import { buildFromCells, buildFromGrid, palette, type BuildSettings } from './build';
import { defaultColorKeys, unusableColors } from './palette';
import { validateTiling } from './score';
import { DEFAULT_FLAT_INVENTORY, DEFAULT_WALL_INVENTORY } from './parts';
import { rgb255ToLinear } from './color';
import { DEFAULT_WEIGHTS } from './score';
import type { CellBuffer, Grid } from './types';

const settings = (overrides: Partial<BuildSettings> = {}): BuildSettings => ({
  orientation: 'pips-out',
  colorKeys: defaultColorKeys([...palette.colors]),
  dither: 'none',
  ditherStrength: 0,
  maxColors: null,
  strict: true,
  inventory: [...DEFAULT_FLAT_INVENTORY],
  weights: DEFAULT_WEIGHTS,
  seed: 3,
  restarts: 12,
  budgetMs: 1000,
  ...overrides,
});

function cells(
  cols: number,
  rows: number,
  at: (c: number, r: number) => readonly [number, number, number]
): CellBuffer {
  const data = new Float32Array(cols * rows * 3);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lin = rgb255ToLinear(at(col, row));
      const i = (row * cols + col) * 3;
      data[i] = lin[0];
      data[i + 1] = lin[1];
      data[i + 2] = lin[2];
    }
  }
  return { cols, rows, data };
}

const red = palette.byKey.get('red')!;
const blue = palette.byKey.get('blue')!;

describe('buildFromCells', () => {
  it('produces a valid tiling', () => {
    const result = buildFromCells(
      cells(24, 24, (c) => (c < 12 ? red.rgb : blue.rgb)),
      settings()
    );
    expect(
      validateTiling(result.tiling, {
        grid: result.grid,
        inventory: DEFAULT_FLAT_INVENTORY,
        strict: true,
        colors: result.colorKeys.map((k) => palette.byKey.get(k)!),
      })
    ).toEqual([]);
  });

  it('reports counts that sum to the cell count', () => {
    const result = buildFromCells(
      cells(16, 16, () => red.rgb),
      settings()
    );
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(256);
  });

  it('names the colors its indices refer to', () => {
    const enabled = defaultColorKeys([...palette.colors]);
    const result = buildFromCells(
      cells(8, 8, () => red.rgb),
      settings({ colorKeys: enabled })
    );
    expect(result.colorKeys[result.grid.colors[0]!]).toBe('red');
    // Strict availability drops whatever the inventory cannot build, so the
    // index list is the enabled set minus exactly those.
    const dropped = unusableColors(
      enabled.map((k) => palette.byKey.get(k)!),
      [...DEFAULT_FLAT_INVENTORY]
    );
    expect(result.colorKeys).toHaveLength(enabled.length - dropped.length);
    for (const c of dropped) expect(result.colorKeys).not.toContain(c.key);
  });

  it('keeps a color the inventory cannot build out of the quantizer', () => {
    // Under strict availability this used to surface as a mid-tile failure:
    // a color with no 1x1 leaves cells nothing can cover.
    const noOnes = palette.colors.find((c) => !c.shapes.includes('3005'))!;
    const result = buildFromCells(
      cells(8, 8, () => red.rgb),
      settings({ colorKeys: [red.key, noOnes.key] })
    );
    expect(result.colorKeys).toEqual([red.key]);
  });

  it('reports progress through both phases', () => {
    const phases = new Set<string>();
    buildFromCells(
      cells(16, 16, () => red.rgb),
      settings(),
      (phase) => phases.add(phase)
    );
    expect(phases).toEqual(new Set(['quantize', 'tile']));
  });

  it('refuses an empty color selection with a useful message', () => {
    expect(() =>
      buildFromCells(
        cells(4, 4, () => red.rgb),
        settings({ colorKeys: [] })
      )
    ).toThrow(/at least one color/);
  });

  it('honours the wall inventory', () => {
    const result = buildFromCells(
      cells(16, 16, () => red.rgb),
      settings({ orientation: 'pips-up', inventory: [...DEFAULT_WALL_INVENTORY] })
    );
    expect(result.tiling.placements.every((p) => p.h === 1)).toBe(true);
  });
});

describe('buildFromGrid', () => {
  const grid: Grid = { cols: 8, rows: 8, colors: new Int16Array(64) };

  it('tiles a restored grid without re-quantizing', () => {
    const result = buildFromGrid(grid, ['red'], settings());
    expect(result.colorKeys).toEqual(['red']);
    expect(result.counts).toEqual([64]);
    expect(
      validateTiling(result.tiling, {
        grid: result.grid,
        inventory: DEFAULT_FLAT_INVENTORY,
        strict: true,
        colors: [red],
      })
    ).toEqual([]);
  });

  it('rejects a color key the palette does not know', () => {
    expect(() => buildFromGrid(grid, ['chartreuse'], settings())).toThrow(
      /unknown color "chartreuse"/
    );
  });

  /**
   * The two entry points must agree: a grid saved from cells and then reloaded
   * has to tile identically, or reopening a project would silently change it.
   */
  it('matches buildFromCells given the same grid and seed', () => {
    const fromCells = buildFromCells(
      cells(16, 16, (c, r) => ((c + r) % 5 === 0 ? blue.rgb : red.rgb)),
      settings()
    );
    const fromGrid = buildFromGrid(fromCells.grid, fromCells.colorKeys, settings());
    expect(fromGrid.tiling.placements).toEqual(fromCells.tiling.placements);
  });
});
