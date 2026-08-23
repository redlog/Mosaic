import { describe, expect, it } from 'vitest';
import { centerCropForAspect, cropAspectFor, frameImage } from './frame';
import { applyAdjustments } from './adjust';
import { quantize } from './quantize';
import { defaultColorKeys, enabledColors, loadPalette } from './palette';
import { finishedSize } from './constants';
import type { Orientation, SourceImage } from './types';

const palette = loadPalette();
/**
 * The colors a new project actually offers — solid, still in production. The
 * full palette also carries retired and transparent colors, and matching
 * against those is not what the app does: Trans-Red and Red are both #C91A09,
 * so a test asserting which one a red pixel lands on would be asserting a
 * tie-break, not behavior.
 */
const colors = enabledColors(palette, defaultColorKeys([...palette.colors]));

/**
 * A synthetic "photograph": a red disc on a blue field with a yellow corner
 * block. Enough structure to tell whether geometry survived the pipeline.
 */
function fixture(width: number, height: number): SourceImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inCorner = x < width * 0.15 && y < height * 0.15;
      const inDisc = (x - cx) ** 2 + (y - cy) ** 2 < radius ** 2;
      const [r, g, b] = inCorner ? [242, 205, 55] : inDisc ? [201, 26, 9] : [0, 85, 191];
      data[i] = r!;
      data[i + 1] = g!;
      data[i + 2] = b!;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Run the whole Phase 2 pipeline the way the app will. */
function build(
  source: SourceImage,
  cols: number,
  rows: number,
  orientation: Orientation
) {
  const crop = centerCropForAspect(
    source.width,
    source.height,
    cropAspectFor(cols, rows, orientation)
  );
  const framed = frameImage(source, cols, rows, { crop });
  const adjusted = applyAdjustments(framed, {
    brightness: 0,
    contrast: 10,
    saturation: 15,
  });
  return quantize(adjusted, colors);
}

describe('end-to-end pipeline', () => {
  it('turns an image into a grid without a browser', () => {
    const result = build(fixture(400, 400), 48, 48, 'pips-out');
    expect(result.grid.cols).toBe(48);
    expect(result.grid.rows).toBe(48);
    expect(result.grid.colors).toHaveLength(48 * 48);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(48 * 48);
  });

  it('preserves the picture: red disc centered on a blue field', () => {
    const result = build(fixture(400, 400), 48, 48, 'pips-out');
    const keyAt = (col: number, row: number) =>
      result.colors[result.grid.colors[row * 48 + col]!]!.key;

    expect(keyAt(24, 24)).toBe('red'); // center of the disc
    expect(keyAt(47, 47)).toBe('blue'); // far corner, background
    expect(keyAt(1, 1)).toBe('yellow'); // the corner block
  });

  it('uses only a handful of colors for a three-color image', () => {
    const result = build(fixture(400, 400), 48, 48, 'pips-out');
    const used = new Set(result.grid.colors).size;
    // Edge antialiasing introduces a few blends, but not dozens.
    expect(used).toBeGreaterThanOrEqual(3);
    expect(used).toBeLessThan(12);
  });

  /**
   * The anti-squash guarantee end to end. A circle in the source must still
   * read as a circle on the wall, which means its cell-space bounding box has
   * to be *taller than it is wide* in pips-up — because each of those cells is
   * rendered 1.2x taller than wide. A square bounding box here would mean a
   * squashed picture on the finished build.
   */
  it('keeps a circle circular in physical space in both orientations', () => {
    for (const orientation of ['pips-out', 'pips-up'] as const) {
      const cols = 60;
      const rows = 60;
      const result = build(fixture(600, 600), cols, rows, orientation);

      const redIndex = result.colors.findIndex((c) => c.key === 'red');
      expect(redIndex).toBeGreaterThanOrEqual(0);

      let minCol = cols;
      let maxCol = -1;
      let minRow = rows;
      let maxRow = -1;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (result.grid.colors[row * cols + col] === redIndex) {
            minCol = Math.min(minCol, col);
            maxCol = Math.max(maxCol, col);
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
          }
        }
      }

      const cellsWide = maxCol - minCol + 1;
      const cellsTall = maxRow - minRow + 1;

      const size = finishedSize(cols, rows, orientation);
      const mmWide = cellsWide * (size.widthMm / cols);
      const mmTall = cellsTall * (size.heightMm / rows);

      // The disc is round in millimetres, whatever the cell aspect.
      expect(mmWide / mmTall).toBeCloseTo(1, 1);

      if (orientation === 'pips-up') {
        // ...which requires fewer rows than columns, since rows are taller.
        expect(cellsTall).toBeLessThan(cellsWide);
      }
    }
  });

  it('handles a non-square grid', () => {
    const result = build(fixture(800, 400), 64, 32, 'pips-out');
    expect(result.grid.cols).toBe(64);
    expect(result.grid.rows).toBe(32);
    expect(result.grid.colors).toHaveLength(2048);
  });

  it('produces a grid small enough to serialize compactly', () => {
    const result = build(fixture(400, 400), 48, 48, 'pips-out');
    // Int16 indices, so the raw grid is two bytes a cell before any RLE.
    expect(result.grid.colors.byteLength).toBe(48 * 48 * 2);
  });

  it('is deterministic across runs', () => {
    const source = fixture(400, 400);
    const a = build(source, 32, 32, 'pips-out');
    const b = build(source, 32, 32, 'pips-out');
    expect([...a.grid.colors]).toEqual([...b.grid.colors]);
  });

  it('stays responsive at the practical ceiling', () => {
    const started = performance.now();
    build(fixture(1200, 1200), 128, 128, 'pips-out');
    // Generous — this only needs to catch an accidental quadratic blowup.
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
