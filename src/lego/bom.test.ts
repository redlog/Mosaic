import { describe, expect, it } from 'vitest';
import { buildBom, groupByColor } from './bom';
import { tile } from './tile';
import { loadPalette } from './palette';
import { DEFAULT_FLAT_INVENTORY } from './parts';
import type { Grid, LegoColor, Tiling } from './types';

const palette = loadPalette();
const colors = [...palette.colors];

function grid(cols: number, rows: number, at: (c: number, r: number) => number): Grid {
  const data = new Int16Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) data[row * cols + col] = at(col, row);
  }
  return { cols, rows, colors: data };
}

const solid = (cols: number, rows: number, colorIdx = 0): Grid =>
  grid(cols, rows, () => colorIdx);

/** A hand-built tiling, so expectations do not depend on tiler heuristics. */
function handTiling(placements: Tiling['placements'], cols = 8, rows = 8): Tiling {
  return {
    orientation: 'pips-out',
    cols,
    rows,
    placements,
    stats: {
      pieces: placements.length,
      ones: 0,
      alignedSeams: 0,
      score: 0,
      seed: 0,
      trials: 1,
      elapsedMs: 0,
    },
  };
}

describe('buildBom', () => {
  it('groups identical part-and-color pairs', () => {
    const bom = buildBom(
      handTiling([
        { designId: '3001', col: 0, row: 0, w: 4, h: 2, colorIdx: 0 },
        { designId: '3001', col: 4, row: 0, w: 4, h: 2, colorIdx: 0 },
        { designId: '3001', col: 0, row: 2, w: 4, h: 2, colorIdx: 1 },
      ]),
      colors
    );
    expect(bom.lines).toHaveLength(2);
    expect(bom.lines[0]).toMatchObject({ designId: '3001', quantity: 2 });
    expect(bom.lines[1]).toMatchObject({ designId: '3001', quantity: 1 });
  });

  it('keeps the same part in different colors as separate lines', () => {
    const bom = buildBom(
      handTiling([
        { designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 0 },
        { designId: '3005', col: 1, row: 0, w: 1, h: 1, colorIdx: 3 },
      ]),
      colors
    );
    expect(bom.lines).toHaveLength(2);
    expect(bom.totals.distinctParts).toBe(2);
    expect(bom.totals.distinctColors).toBe(2);
  });

  it('counts a rotated brick as the same part', () => {
    // 3001 laid 4x2 and 2x4 is one part number either way.
    const bom = buildBom(
      handTiling([
        { designId: '3001', col: 0, row: 0, w: 4, h: 2, colorIdx: 0 },
        { designId: '3001', col: 0, row: 2, w: 2, h: 4, colorIdx: 0 },
      ]),
      colors
    );
    expect(bom.lines).toHaveLength(1);
    expect(bom.lines[0]!.quantity).toBe(2);
  });

  it('sorts by palette order, then by descending part size', () => {
    const bom = buildBom(
      handTiling([
        { designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 2 },
        { designId: '3007', col: 0, row: 1, w: 8, h: 2, colorIdx: 2 },
        { designId: '3004', col: 0, row: 3, w: 2, h: 1, colorIdx: 0 },
      ]),
      colors
    );
    expect(bom.lines.map((l) => [l.colorKey, l.designId])).toEqual([
      [colors[0]!.key, '3004'],
      [colors[2]!.key, '3007'],
      [colors[2]!.key, '3005'],
    ]);
  });

  it('rejects a placement whose color is not in the palette', () => {
    expect(() =>
      buildBom(
        handTiling([{ designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 9999 }]),
        colors
      )
    ).toThrow(/not in the palette/);
  });
});

describe('totals', () => {
  const g = solid(24, 24);
  const tiling = tile(g, 'pips-out', {
    inventory: DEFAULT_FLAT_INVENTORY,
    seed: 3,
    restarts: 20,
  });
  const bom = buildBom(tiling, colors);

  it('sums quantities to the piece count', () => {
    expect(bom.totals.pieces).toBe(tiling.placements.length);
    expect(bom.lines.reduce((sum, l) => sum + l.quantity, 0)).toBe(
      tiling.placements.length
    );
  });

  /** Every stud is covered exactly once, so this must equal the cell count. */
  it('sums studs to the grid size', () => {
    expect(bom.totals.studs).toBe(24 * 24);
  });

  it('counts 1x1s and their share', () => {
    expect(bom.totals.ones).toBe(tiling.stats.ones);
    expect(bom.totals.onesFraction).toBeCloseTo(
      tiling.stats.ones / tiling.placements.length,
      10
    );
  });

  it('breaks totals down by shape, heaviest first', () => {
    const sum = bom.shapeTotals.reduce((s, t) => s + t.quantity, 0);
    expect(sum).toBe(bom.totals.pieces);
    for (let i = 1; i < bom.shapeTotals.length; i++) {
      expect(bom.shapeTotals[i]!.quantity).toBeLessThanOrEqual(
        bom.shapeTotals[i - 1]!.quantity
      );
    }
  });

  it('handles an empty tiling without dividing by zero', () => {
    const empty = buildBom(handTiling([]), colors);
    expect(empty.totals).toMatchObject({ pieces: 0, studs: 0, onesFraction: 0 });
    expect(empty.lines).toEqual([]);
  });
});

describe('warnings', () => {
  const noId: LegoColor[] = [{ ...colors[0]!, blColorId: null }];

  it('flags colors that cannot reach the BrickLink export', () => {
    const bom = buildBom(
      handTiling([
        { designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 0 },
        { designId: '3005', col: 1, row: 0, w: 1, h: 1, colorIdx: 0 },
      ]),
      noId
    );
    expect(bom.warnings.join()).toMatch(/no BrickLink color ID/);
    expect(bom.warnings.join()).toMatch(/2 bricks/);
  });

  it('says nothing when every color has an ID', () => {
    const bom = buildBom(
      handTiling([{ designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 0 }]),
      colors
    );
    expect(bom.warnings).toEqual([]);
  });
});

describe('groupByColor', () => {
  it('collects a color’s lines and totals them', () => {
    const bom = buildBom(
      handTiling([
        { designId: '3007', col: 0, row: 0, w: 8, h: 2, colorIdx: 0 },
        { designId: '3005', col: 0, row: 2, w: 1, h: 1, colorIdx: 0 },
        { designId: '3005', col: 1, row: 2, w: 1, h: 1, colorIdx: 0 },
        { designId: '3005', col: 2, row: 2, w: 1, h: 1, colorIdx: 4 },
      ]),
      colors
    );
    const groups = groupByColor(bom);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ colorKey: colors[0]!.key, quantity: 3 });
    expect(groups[0]!.lines).toHaveLength(2);
    expect(groups[1]).toMatchObject({ colorKey: colors[4]!.key, quantity: 1 });
  });

  it('preserves the line ordering within a group', () => {
    const bom = buildBom(
      handTiling([
        { designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 0 },
        { designId: '3007', col: 0, row: 1, w: 8, h: 2, colorIdx: 0 },
      ]),
      colors
    );
    expect(groupByColor(bom)[0]!.lines.map((l) => l.designId)).toEqual(['3007', '3005']);
  });
});
