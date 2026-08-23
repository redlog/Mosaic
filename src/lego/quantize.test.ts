import { describe, expect, it } from 'vitest';
import { quantize, selectColors } from './quantize';
import { defaultColorKeys, enabledColors, loadPalette } from './palette';
import { rgb255ToLinear } from './color';
import type { CellBuffer, LegoColor } from './types';

const palette = loadPalette();
/**
 * The colors a new project actually offers — solid, still in production. The
 * full palette also carries retired and transparent colors, and matching
 * against those is not what the app does: Trans-Red and Red are both #C91A09,
 * so a test asserting which one a red pixel lands on would be asserting a
 * tie-break, not behavior.
 */
const all = enabledColors(palette, defaultColorKeys([...palette.colors]));

const pick = (...keys: string[]): LegoColor[] => keys.map((k) => palette.byKey.get(k)!);

/** The palette key a result actually assigned to its first cell. */
const mapped = (result: { grid: { colors: Int16Array }; colors: LegoColor[] }): string =>
  result.colors[result.grid.colors[0]!]!.key;

/** How many distinct colors a result actually used. */
const distinctUsed = (result: { grid: { colors: Int16Array } }): number =>
  new Set(result.grid.colors).size;

/** A buffer where every cell holds the same sRGB color. */
function uniform(
  cols: number,
  rows: number,
  rgb: readonly [number, number, number]
): CellBuffer {
  const lin = rgb255ToLinear(rgb);
  const data = new Float32Array(cols * rows * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = lin[0];
    data[i + 1] = lin[1];
    data[i + 2] = lin[2];
  }
  return { cols, rows, data };
}

/** A buffer built from a per-cell sRGB function. */
function buffer(
  cols: number,
  rows: number,
  at: (col: number, row: number) => readonly [number, number, number]
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

describe('basic mapping', () => {
  it('maps a monochrome image to exactly one color', () => {
    const result = quantize(uniform(8, 8, [201, 26, 9]), all);
    expect(distinctUsed(result)).toBe(1);
    expect(result.counts.filter((c) => c > 0)).toHaveLength(1);
  });

  it('picks a color exactly when the cell already is one', () => {
    for (const key of ['white', 'black', 'red', 'blue', 'yellow']) {
      const color = palette.byKey.get(key)!;
      expect(mapped(quantize(uniform(2, 2, color.rgb), all))).toBe(key);
    }
  });

  it('produces one index per cell, all in range', () => {
    const result = quantize(
      buffer(7, 5, (c, r) => [c * 30, r * 40, 128]),
      all
    );
    expect(result.grid.colors).toHaveLength(35);
    expect(result.grid.cols).toBe(7);
    expect(result.grid.rows).toBe(5);
    for (const idx of result.grid.colors) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(result.colors.length);
    }
  });

  it('reports counts that sum to the cell count', () => {
    const result = quantize(
      buffer(9, 6, (c, r) => [c * 25, r * 35, 90]),
      all
    );
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(54);
    expect(result.counts).toHaveLength(result.colors.length);
  });

  it('never emits a color outside the supplied palette', () => {
    const limited = pick('white', 'black');
    const result = quantize(
      buffer(6, 6, (c, r) => [c * 40, r * 40, 200]),
      limited
    );
    expect(result.colors.map((c) => c.key).sort()).toEqual(['black', 'white']);
    for (const idx of result.grid.colors) expect(idx).toBeLessThan(2);
  });

  it('is deterministic', () => {
    const cells = buffer(12, 12, (c, r) => [(c * 17) % 256, (r * 23) % 256, 128]);
    const a = quantize(cells, all);
    const b = quantize(cells, all);
    expect([...a.grid.colors]).toEqual([...b.grid.colors]);
  });

  it('refuses an empty palette with a useful message', () => {
    expect(() => quantize(uniform(2, 2, [0, 0, 0]), [])).toThrow(
      /enable at least one color/
    );
  });
});

describe('perceptual matching', () => {
  it('sends near-black to black and near-white to white', () => {
    expect(mapped(quantize(uniform(1, 1, [8, 10, 14]), all))).toBe('black');
    expect(mapped(quantize(uniform(1, 1, [250, 250, 250]), all))).toBe('white');
  });

  it('keeps hue families intact', () => {
    const cases: Array<[[number, number, number], string]> = [
      [[200, 30, 20], 'red'],
      [[20, 80, 190], 'blue'],
      [[240, 205, 60], 'yellow'],
    ];
    for (const [rgb, expected] of cases) {
      expect(mapped(quantize(uniform(1, 1, rgb), all))).toBe(expected);
    }
  });
});

describe('dithering', () => {
  const gradient = buffer(16, 16, (c) => [c * 16, c * 16, c * 16]);

  it('is a no-op at strength 0', () => {
    const off = quantize(gradient, all, { dither: 'none' });
    const zero = quantize(gradient, all, {
      dither: 'floyd-steinberg',
      ditherStrength: 0,
    });
    expect([...zero.grid.colors]).toEqual([...off.grid.colors]);
  });

  it('changes the result at full strength', () => {
    const off = quantize(gradient, all, { dither: 'none' });
    const on = quantize(gradient, all, { dither: 'floyd-steinberg', ditherStrength: 1 });
    expect([...on.grid.colors]).not.toEqual([...off.grid.colors]);
  });

  /**
   * The tradeoff DESIGN.md §6.4 warns about, made measurable: dithering breaks
   * flat regions into more distinct colors, which is exactly the pattern the
   * tiler cannot merge into large bricks.
   */
  it('increases the number of distinct colors used', () => {
    const off = quantize(gradient, all, { dither: 'none' });
    const on = quantize(gradient, all, { dither: 'floyd-steinberg', ditherStrength: 1 });
    expect(distinctUsed(on)).toBeGreaterThanOrEqual(distinctUsed(off));
  });

  it('still covers every cell exactly once', () => {
    const result = quantize(gradient, all, {
      dither: 'floyd-steinberg',
      ditherStrength: 1,
    });
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(256);
    for (const idx of result.grid.colors) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(result.colors.length);
    }
  });

  it('leaves a monochrome image monochrome — there is no error to diffuse', () => {
    const exact = palette.byKey.get('red')!;
    const result = quantize(uniform(8, 8, exact.rgb), all, {
      dither: 'floyd-steinberg',
      ditherStrength: 1,
    });
    expect(distinctUsed(result)).toBe(1);
  });

  it('clamps strength above 1', () => {
    const a = quantize(gradient, all, { dither: 'floyd-steinberg', ditherStrength: 1 });
    const b = quantize(gradient, all, { dither: 'floyd-steinberg', ditherStrength: 9 });
    expect([...b.grid.colors]).toEqual([...a.grid.colors]);
  });
});

describe('maxColors', () => {
  const photo = buffer(24, 24, (c, r) => [
    (c * 11 + r * 3) % 256,
    (r * 13 + c * 5) % 256,
    (c * 7 + r * 17) % 256,
  ]);

  it('caps the distinct colors used', () => {
    const result = quantize(photo, all, { maxColors: 6 });
    expect(result.colors).toHaveLength(6);
    expect(new Set(result.grid.colors).size).toBeLessThanOrEqual(6);
  });

  it('does nothing when the cap exceeds the palette', () => {
    const result = quantize(photo, all, { maxColors: all.length + 10 });
    expect(result.colors).toHaveLength(all.length);
  });

  it('ignores a null cap', () => {
    expect(quantize(photo, all, { maxColors: null }).colors).toHaveLength(all.length);
  });

  it('returns the reduced set in palette order, so the UI list stays stable', () => {
    const chosen = selectColors(photo, all, 8);
    const positions = chosen.map((c) => all.findIndex((x) => x.key === c.key));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('picks the obviously right colors for an obvious image', () => {
    // Half pure red, half pure blue: a two-color budget should find both.
    const red = palette.byKey.get('red')!;
    const blue = palette.byKey.get('blue')!;
    const split = buffer(8, 8, (c) => (c < 4 ? red.rgb : blue.rgb));
    const chosen = selectColors(split, all, 2).map((c) => c.key);
    expect(chosen.sort()).toEqual(['blue', 'red']);
  });

  it('weights selection by area, not by distinct color count', () => {
    // 63 cells of red, one of blue. With a budget of one, red must win.
    const red = palette.byKey.get('red')!;
    const blue = palette.byKey.get('blue')!;
    const mostlyRed = buffer(8, 8, (c, r) => (c === 0 && r === 0 ? blue.rgb : red.rgb));
    expect(selectColors(mostlyRed, all, 1)[0]!.key).toBe('red');
  });

  it('handles degenerate budgets', () => {
    expect(selectColors(photo, all, 0)).toEqual([]);
    expect(selectColors(photo, all, 1)).toHaveLength(1);
  });
});
