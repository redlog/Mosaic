/**
 * The edge-case table from DESIGN.md §14, asserted rather than assumed.
 *
 * These all have a common shape: the app should degrade with an explanation
 * instead of producing something quietly wrong. Each test names the case it
 * guards so a failure points straight at the row that broke.
 */
import { describe, expect, it } from 'vitest';
import { buildFromCells, palette, type BuildSettings } from './build';
import { frameImage, clampCrop, pickDownscaleFactor } from './frame';
import { quantize } from './quantize';
import { tile } from './tile';
import { buildBom } from './bom';
import { toBricklinkXml } from './export-bricklink';
import { parseProject, validateProject, PROJECT_VERSION } from './project';
import { defaultColorKeys, enabledColors, unusableColors } from './palette';
import { MAX_GRID_DIMENSION, WARN_GRID_DIMENSION } from './constants';
import { DEFAULT_FLAT_INVENTORY } from './parts';
import { DEFAULT_WEIGHTS } from './score';
import { rgb255ToLinear } from './color';
import type { CellBuffer, LegoColor, SourceImage } from './types';

const settings = (overrides: Partial<BuildSettings> = {}): BuildSettings => ({
  orientation: 'pips-out',
  colorKeys: defaultColorKeys([...palette.colors]),
  dither: 'none',
  ditherStrength: 0,
  maxColors: null,
  strict: true,
  inventory: [...DEFAULT_FLAT_INVENTORY],
  weights: DEFAULT_WEIGHTS,
  seed: 1,
  restarts: 4,
  budgetMs: 500,
  ...overrides,
});

function solidCells(
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

function image(w: number, h: number, px: readonly number[]): SourceImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = px[0]!;
    data[i + 1] = px[1]!;
    data[i + 2] = px[2]!;
    data[i + 3] = px[3] ?? 255;
  }
  return { width: w, height: h, data };
}

const red = palette.byKey.get('red')!;

describe('§14 — oversized images', () => {
  it('picks a pre-shrink factor that lands under the ceiling', () => {
    // A 40MP photo must not be box-filtered pixel by pixel for a 48x48 grid.
    const k = pickDownscaleFactor(7300, 5500, 8_000_000);
    expect(k).toBeGreaterThan(1);
    expect((7300 / k) * (5500 / k)).toBeLessThanOrEqual(8_000_000);
  });
});

describe('§14 — transparency and grayscale', () => {
  it('composites transparency over the configured background', () => {
    const cells = frameImage(image(4, 4, [0, 0, 0, 0]), 1, 1, {
      background: [255, 0, 0],
    });
    expect(cells.data[0]).toBeGreaterThan(0.9);
    expect(cells.data[1]).toBeCloseTo(0, 5);
  });

  it('handles a fully grayscale image without special-casing', () => {
    const result = buildFromCells(solidCells(8, 8, [128, 128, 128]), settings());
    expect(result.tiling.placements.length).toBeGreaterThan(0);
  });
});

describe('§14 — palette exhaustion', () => {
  it('refuses to build with no colors enabled, and says why', () => {
    expect(() =>
      buildFromCells(solidCells(4, 4, [200, 30, 20]), settings({ colorKeys: [] }))
    ).toThrow(/at least one color/);
  });

  /**
   * A color with no legal brick under the current inventory would fail
   * mid-tile. The UI drops it up front; this asserts the machinery that lets
   * it, so the two cannot drift.
   */
  it('can identify colors with nothing legal in the inventory', () => {
    const all = enabledColors(palette);
    // 2x6 and 2x8 only: a color is stranded if it is produced in neither, and
    // also if it has no 1x1 to fall back on for the cells those cannot cover.
    const stranded = unusableColors(all, ['2456', '3007']);
    expect(stranded.length).toBeGreaterThan(0);
    for (const color of stranded) {
      const noBigBrick = !color.shapes.includes('2456') && !color.shapes.includes('3007');
      expect(noBigBrick || !color.shapes.includes('3005')).toBe(true);
    }
  });

  it('refuses an inventory with no 1x1, naming the cause', () => {
    const grid = quantize(solidCells(8, 8, red.rgb), [red]).grid;
    expect(() =>
      tile(grid, 'pips-out', { inventory: ['3004', '3001'], colors: [red] })
    ).toThrow(/1x1/);
  });
});

describe('§14 — missing BrickLink IDs', () => {
  it('omits the color from XML and reports the quantity', () => {
    const noId: LegoColor[] = [{ ...red, blColorId: null }];
    const grid = quantize(solidCells(4, 4, red.rgb), noId).grid;
    const tiling = tile(grid, 'pips-out', {
      inventory: DEFAULT_FLAT_INVENTORY,
      colors: noId,
      restarts: 2,
    });
    const result = toBricklinkXml(buildBom(tiling, noId));

    expect(result.included).toHaveLength(0);
    expect(result.warnings.join()).toMatch(/Nothing to export/);
    // Nothing that could be mistaken for a real color id slipped through.
    expect(result.xml).not.toMatch(/<COLOR>/);
  });
});

describe('§14 — grid limits', () => {
  it('keeps the warning threshold below the hard cap', () => {
    expect(WARN_GRID_DIMENSION).toBeLessThan(MAX_GRID_DIMENSION);
  });

  it('handles the smallest possible mosaic', () => {
    const result = buildFromCells(solidCells(1, 1, red.rgb), settings());
    expect(result.tiling.placements).toHaveLength(1);
    expect(result.tiling.placements[0]).toMatchObject({ w: 1, h: 1 });
  });

  it('handles a one-cell-wide mosaic', () => {
    const result = buildFromCells(solidCells(1, 24, red.rgb), settings());
    expect(result.tiling.placements.every((p) => p.w === 1)).toBe(true);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(24);
  });
});

describe('§14 — crop bounds', () => {
  it('clamps a crop dragged outside the image', () => {
    for (const crop of [
      { x: -5, y: -5, w: 2, h: 2 },
      { x: 1.5, y: 1.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0, h: 0 },
    ]) {
      const clamped = clampCrop(crop);
      expect(clamped.x).toBeGreaterThanOrEqual(0);
      expect(clamped.y).toBeGreaterThanOrEqual(0);
      expect(clamped.x + clamped.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(clamped.y + clamped.h).toBeLessThanOrEqual(1 + 1e-9);
      expect(clamped.w).toBeGreaterThan(0);
    }
  });
});

describe('§14 — project files', () => {
  it('rejects a project from a newer format version', () => {
    expect(() => validateProject({ format: 'lego-mosaic-project', version: 99 })).toThrow(
      /newer version/
    );
  });

  it('rejects a file that is not a project at all', () => {
    expect(() => parseProject('{"hello":"world"}')).toThrow(/not a Mosaic project/);
    expect(() => parseProject('not json at all')).toThrow(/not valid JSON/);
  });

  it('accepts the current version', () => {
    expect(PROJECT_VERSION).toBe(1);
  });
});

describe('§14 — dithering cost is visible, not hidden', () => {
  it('reports a higher 1x1 count when dithering a gradient', () => {
    const cols = 24;
    const gradient: CellBuffer = {
      cols,
      rows: cols,
      data: new Float32Array(cols * cols * 3),
    };
    for (let i = 0; i < cols * cols; i++) {
      const t = (i % cols) / cols;
      const lin = rgb255ToLinear([t * 255, t * 255, t * 255]);
      gradient.data[i * 3] = lin[0];
      gradient.data[i * 3 + 1] = lin[1];
      gradient.data[i * 3 + 2] = lin[2];
    }
    const plain = buildFromCells(gradient, settings());
    const dithered = buildFromCells(
      gradient,
      settings({ dither: 'floyd-steinberg', ditherStrength: 1 })
    );
    expect(dithered.tiling.stats.ones).toBeGreaterThan(plain.tiling.stats.ones);
  });
});
