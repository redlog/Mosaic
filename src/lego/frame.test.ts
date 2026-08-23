import { describe, expect, it } from 'vitest';
import {
  centerCropForAspect,
  clampCrop,
  cropAspectFor,
  frameImage,
  pickDownscaleFactor,
  transformedSize,
} from './frame';
import { linearToSrgb, srgbToLinear } from './color';
import { finishedSize } from './constants';
import type { Rotation, SourceImage } from './types';

/** Build an RGBA source from a `[r,g,b]` or `[r,g,b,a]` per-pixel function. */
function image(
  width: number,
  height: number,
  at: (x: number, y: number) => readonly number[]
): SourceImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = at(x, y);
      const i = (y * width + x) * 4;
      data[i] = px[0]!;
      data[i + 1] = px[1]!;
      data[i + 2] = px[2]!;
      data[i + 3] = px[3] ?? 255;
    }
  }
  return { width, height, data };
}

const solid = (w: number, h: number, rgb: readonly number[]): SourceImage =>
  image(w, h, () => rgb);

/** Read one cell back as 0-255 sRGB, the way it will eventually be seen. */
function cellSrgb(
  buffer: { cols: number; data: Float32Array },
  col: number,
  row: number
): [number, number, number] {
  const i = (row * buffer.cols + col) * 3;
  return [
    Math.round(linearToSrgb(buffer.data[i]!) * 255),
    Math.round(linearToSrgb(buffer.data[i + 1]!) * 255),
    Math.round(linearToSrgb(buffer.data[i + 2]!) * 255),
  ];
}

describe('gamma correctness', () => {
  /**
   * The regression test for the whole downsampling stage. Averaging
   * gamma-encoded sRGB gives 128 here; averaging in linear light gives 188,
   * which is the physically correct mid-point of black and white.
   *
   * If this ever reads 128, every mosaic the app produces is muddy and dark.
   */
  it('averages a black-and-white checkerboard to sRGB 188, not 128', () => {
    const checker = image(8, 8, (x, y) =>
      (x + y) % 2 === 0 ? [0, 0, 0] : [255, 255, 255]
    );
    const cells = frameImage(checker, 1, 1);
    expect(cells.data[0]).toBeCloseTo(0.5, 6);
    expect(cellSrgb(cells, 0, 0)).toEqual([188, 188, 188]);
  });

  it('averages a half-black half-white split the same way', () => {
    const split = image(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]));
    expect(cellSrgb(frameImage(split, 1, 1), 0, 0)).toEqual([188, 188, 188]);
  });

  it('averages mid-tones in linear light', () => {
    const pair = image(2, 1, (x) => (x === 0 ? [64, 64, 64] : [192, 192, 192]));
    const expected = (srgbToLinear(64 / 255) + srgbToLinear(192 / 255)) / 2;
    expect(frameImage(pair, 1, 1).data[0]).toBeCloseTo(expected, 6);
  });
});

describe('box filter', () => {
  it('leaves a solid color untouched at any grid size', () => {
    const source = solid(16, 16, [201, 26, 9]);
    for (const [cols, rows] of [
      [1, 1],
      [4, 4],
      [16, 16],
      [3, 7],
    ]) {
      const cells = frameImage(source, cols!, rows!);
      for (let i = 0; i < cols! * rows!; i++) {
        expect(cellSrgb(cells, i % cols!, Math.floor(i / cols!))).toEqual([201, 26, 9]);
      }
    }
  });

  it('averages all four quadrants into a single cell', () => {
    const quad = image(2, 2, (x, y) => {
      if (x === 0 && y === 0) return [255, 0, 0];
      if (x === 1 && y === 0) return [0, 255, 0];
      if (x === 0 && y === 1) return [0, 0, 255];
      return [255, 255, 255];
    });
    const cells = frameImage(quad, 1, 1);
    const expectedR = (srgbToLinear(1) + 0 + 0 + srgbToLinear(1)) / 4;
    expect(cells.data[0]).toBeCloseTo(expectedR, 6);
  });

  it('preserves a 1:1 mapping exactly', () => {
    const source = image(3, 2, (x, y) => [x * 40, y * 60, 128]);
    const cells = frameImage(source, 3, 2);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        expect(cellSrgb(cells, x, y)).toEqual([x * 40, y * 60, 128]);
      }
    }
  });

  /**
   * With three source pixels across two cells, the middle pixel straddles the
   * boundary and must contribute half its weight to each — the property that
   * separates an area-weighted box filter from nearest-neighbour sampling.
   */
  it('weights a straddling pixel by its actual overlap', () => {
    const source = image(3, 1, (x) => [x === 0 ? 0 : x === 1 ? 255 : 0, 0, 0]);
    const cells = frameImage(source, 2, 1);
    // Cell 0 covers pixel 0 fully and half of pixel 1.
    const expected = (0 + srgbToLinear(1) * 0.5) / 1.5;
    expect(cells.data[0]).toBeCloseTo(expected, 6);
    expect(cells.data[3]).toBeCloseTo(expected, 6);
  });

  it('upsamples without dividing by zero', () => {
    const source = image(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]));
    const cells = frameImage(source, 6, 3);
    expect(cells.data).toHaveLength(6 * 3 * 3);
    expect([...cells.data].every(Number.isFinite)).toBe(true);
    expect(cellSrgb(cells, 0, 0)).toEqual([0, 0, 0]);
    expect(cellSrgb(cells, 5, 2)).toEqual([255, 255, 255]);
  });

  it('rejects degenerate inputs rather than producing nonsense', () => {
    expect(() => frameImage(solid(4, 4, [0, 0, 0]), 0, 4)).toThrow(/at least 1x1/);
    expect(() =>
      frameImage({ width: 0, height: 0, data: new Uint8ClampedArray() }, 1, 1)
    ).toThrow(/empty/);
    expect(() =>
      frameImage({ width: 4, height: 4, data: new Uint8ClampedArray(8) }, 1, 1)
    ).toThrow(/shorter than its dimensions/);
  });
});

describe('cropping', () => {
  it('samples only inside the crop', () => {
    // Left half black, right half white; crop to the right half only.
    const source = image(4, 1, (x) => (x < 2 ? [0, 0, 0] : [255, 255, 255]));
    const cells = frameImage(source, 1, 1, { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    expect(cellSrgb(cells, 0, 0)).toEqual([255, 255, 255]);
  });

  it('clamps a crop that runs off the edge', () => {
    expect(clampCrop({ x: -1, y: -1, w: 2, h: 2 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(clampCrop({ x: 0.9, y: 0, w: 0.5, h: 1 })).toMatchObject({ x: 0.5, w: 0.5 });
  });

  it('keeps a zero-size crop usable instead of dividing by zero', () => {
    const clamped = clampCrop({ x: 0.5, y: 0.5, w: 0, h: 0 });
    expect(clamped.w).toBeGreaterThan(0);
    const cells = frameImage(solid(4, 4, [12, 34, 56]), 2, 2, { crop: clamped });
    expect([...cells.data].every(Number.isFinite)).toBe(true);
    expect(cellSrgb(cells, 0, 0)).toEqual([12, 34, 56]);
  });
});

describe('crop aspect', () => {
  it('equals cols/rows only in pips-out', () => {
    expect(cropAspectFor(48, 48, 'pips-out')).toBeCloseTo(1, 12);
    expect(cropAspectFor(48, 48, 'pips-up')).toBeCloseTo(5 / 6, 12);
  });

  /**
   * The anti-squash guarantee (DESIGN.md §2.4a): a crop taken at the mosaic's
   * aspect must have the same shape as the finished physical build, so nothing
   * is stretched on the way through. Without the 5:6 cell in the calculation,
   * a pips-up mosaic comes out vertically compressed.
   */
  it('makes the crop the same shape as the finished build', () => {
    for (const orientation of ['pips-out', 'pips-up'] as const) {
      for (const [cols, rows] of [
        [48, 48],
        [64, 32],
        [30, 50],
      ]) {
        const aspect = cropAspectFor(cols!, rows!, orientation);
        const crop = centerCropForAspect(1000, 1000, aspect);
        const cropPixelAspect = (crop.w * 1000) / (crop.h * 1000);
        const built = finishedSize(cols!, rows!, orientation);
        expect(cropPixelAspect).toBeCloseTo(built.widthMm / built.heightMm, 10);
      }
    }
  });

  it('is not fooled into a square crop for a square pips-up grid', () => {
    const crop = centerCropForAspect(1000, 1000, cropAspectFor(48, 48, 'pips-up'));
    // Taller than wide, so the extra vertical resolution has somewhere to come from.
    expect(crop.w).toBeLessThan(crop.h);
    expect(crop.w / crop.h).toBeCloseTo(5 / 6, 10);
  });
});

describe('centerCropForAspect', () => {
  it('trims the sides of a too-wide image', () => {
    const crop = centerCropForAspect(200, 100, 1);
    expect(crop).toMatchObject({ y: 0, h: 1 });
    expect(crop.w).toBeCloseTo(0.5, 10);
    expect(crop.x).toBeCloseTo(0.25, 10);
  });

  it('trims the top and bottom of a too-tall image', () => {
    const crop = centerCropForAspect(100, 200, 1);
    expect(crop).toMatchObject({ x: 0, w: 1 });
    expect(crop.h).toBeCloseTo(0.5, 10);
    expect(crop.y).toBeCloseTo(0.25, 10);
  });

  it('uses the whole image when the aspect already matches', () => {
    expect(centerCropForAspect(160, 90, 16 / 9)).toMatchObject({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });
});

describe('transform', () => {
  // A 2x1 image: black on the left, white on the right.
  const source = image(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]));

  it('swaps dimensions on quarter turns only', () => {
    expect(transformedSize(4, 2, 0)).toEqual({ width: 4, height: 2 });
    expect(transformedSize(4, 2, 90)).toEqual({ width: 2, height: 4 });
    expect(transformedSize(4, 2, 180)).toEqual({ width: 4, height: 2 });
    expect(transformedSize(4, 2, 270)).toEqual({ width: 2, height: 4 });
  });

  it('rotates 90 degrees clockwise: left edge becomes top edge', () => {
    const cells = frameImage(source, 1, 2, {
      transform: { rotate: 90, flipH: false, flipV: false },
    });
    expect(cellSrgb(cells, 0, 0)).toEqual([0, 0, 0]);
    expect(cellSrgb(cells, 0, 1)).toEqual([255, 255, 255]);
  });

  it('rotates 270 degrees: left edge becomes bottom edge', () => {
    const cells = frameImage(source, 1, 2, {
      transform: { rotate: 270, flipH: false, flipV: false },
    });
    expect(cellSrgb(cells, 0, 0)).toEqual([255, 255, 255]);
    expect(cellSrgb(cells, 0, 1)).toEqual([0, 0, 0]);
  });

  it('rotates 180 degrees', () => {
    const cells = frameImage(source, 2, 1, {
      transform: { rotate: 180, flipH: false, flipV: false },
    });
    expect(cellSrgb(cells, 0, 0)).toEqual([255, 255, 255]);
    expect(cellSrgb(cells, 1, 0)).toEqual([0, 0, 0]);
  });

  it('flips horizontally and vertically', () => {
    const h = frameImage(source, 2, 1, {
      transform: { rotate: 0, flipH: true, flipV: false },
    });
    expect(cellSrgb(h, 0, 0)).toEqual([255, 255, 255]);

    const tall = image(1, 2, (_x, y) => (y === 0 ? [0, 0, 0] : [255, 255, 255]));
    const v = frameImage(tall, 1, 2, {
      transform: { rotate: 0, flipH: false, flipV: true },
    });
    expect(cellSrgb(v, 0, 0)).toEqual([255, 255, 255]);
  });

  it('returns to the original after four quarter turns', () => {
    const corner = image(3, 2, (x, y) => [x * 60, y * 90, 30]);
    const original = [...frameImage(corner, 3, 2).data];
    let rotated = corner;
    for (let i = 0; i < 4; i++) {
      const size = transformedSize(rotated.width, rotated.height, 90);
      const cells = frameImage(rotated, size.width, size.height, {
        transform: { rotate: 90, flipH: false, flipV: false },
      });
      // Re-encode the rotated cells as a source image for the next turn.
      rotated = image(size.width, size.height, (x, y) => {
        const i2 = (y * size.width + x) * 3;
        return [
          Math.round(linearToSrgb(cells.data[i2]!) * 255),
          Math.round(linearToSrgb(cells.data[i2 + 1]!) * 255),
          Math.round(linearToSrgb(cells.data[i2 + 2]!) * 255),
        ];
      });
    }
    const roundTripped = [...frameImage(rotated, 3, 2).data];
    for (let i = 0; i < original.length; i++) {
      expect(roundTripped[i]).toBeCloseTo(original[i]!, 5);
    }
  });

  it('samples every pixel exactly once under rotation', () => {
    for (const rotate of [0, 90, 180, 270] as Rotation[]) {
      const src = image(4, 3, (x, y) => [x * 50, y * 80, 0]);
      const size = transformedSize(4, 3, rotate);
      const cells = frameImage(src, size.width, size.height, {
        transform: { rotate, flipH: false, flipV: false },
      });
      const seen = new Set<string>();
      for (let y = 0; y < size.height; y++) {
        for (let x = 0; x < size.width; x++) seen.add(cellSrgb(cells, x, y).join(','));
      }
      expect(seen.size).toBe(12);
    }
  });
});

describe('alpha', () => {
  it('composites transparency over white by default', () => {
    const transparent = solid(2, 2, [0, 0, 0, 0]);
    expect(cellSrgb(frameImage(transparent, 1, 1), 0, 0)).toEqual([255, 255, 255]);
  });

  it('honours a chosen background', () => {
    const transparent = solid(2, 2, [0, 0, 0, 0]);
    const cells = frameImage(transparent, 1, 1, { background: [255, 0, 0] });
    expect(cellSrgb(cells, 0, 0)).toEqual([255, 0, 0]);
  });

  it('blends partial alpha in linear light', () => {
    const half = solid(1, 1, [0, 0, 0, 128]);
    const cells = frameImage(half, 1, 1, { background: [255, 255, 255] });
    const alpha = 128 / 255;
    expect(cells.data[0]).toBeCloseTo(srgbToLinear(1) * (1 - alpha), 5);
  });

  it('leaves fully opaque pixels alone', () => {
    const opaque = solid(2, 2, [10, 20, 30, 255]);
    const cells = frameImage(opaque, 1, 1, { background: [255, 0, 255] });
    expect(cellSrgb(cells, 0, 0)).toEqual([10, 20, 30]);
  });
});

describe('pickDownscaleFactor', () => {
  it('leaves images under the ceiling alone', () => {
    expect(pickDownscaleFactor(1000, 1000, 8_000_000)).toBe(1);
    expect(pickDownscaleFactor(2828, 2828, 8_000_000)).toBe(1);
  });

  it('shrinks enough to land under the ceiling', () => {
    for (const [w, h] of [
      [8000, 6000],
      [12000, 9000],
      [40000, 1000],
    ]) {
      const k = pickDownscaleFactor(w!, h!, 8_000_000);
      expect((w! / k) * (h! / k)).toBeLessThanOrEqual(8_000_000);
      // And is not needlessly aggressive.
      expect((w! / (k - 1)) * (h! / (k - 1))).toBeGreaterThan(8_000_000);
    }
  });

  it('is defensive about a nonsense ceiling', () => {
    expect(pickDownscaleFactor(100, 100, 0)).toBe(1);
    expect(pickDownscaleFactor(100, 100, -5)).toBe(1);
  });
});
