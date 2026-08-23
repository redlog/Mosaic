import { describe, expect, it } from 'vitest';
import { NO_ADJUSTMENTS, applyAdjustments, isIdentity } from './adjust';
import { linearToSrgb, srgbToLinear } from './color';
import type { Adjustments, CellBuffer } from './types';

/** A 1x1 buffer holding one sRGB color, for readable assertions. */
function cell(r: number, g: number, b: number): CellBuffer {
  return {
    cols: 1,
    rows: 1,
    data: new Float32Array([
      srgbToLinear(r / 255),
      srgbToLinear(g / 255),
      srgbToLinear(b / 255),
    ]),
  };
}

function readSrgb(buffer: CellBuffer): [number, number, number] {
  return [
    Math.round(linearToSrgb(buffer.data[0]!) * 255),
    Math.round(linearToSrgb(buffer.data[1]!) * 255),
    Math.round(linearToSrgb(buffer.data[2]!) * 255),
  ];
}

const adj = (partial: Partial<Adjustments>): Adjustments => ({
  ...NO_ADJUSTMENTS,
  ...partial,
});

describe('identity', () => {
  it('recognizes a no-op', () => {
    expect(isIdentity(NO_ADJUSTMENTS)).toBe(true);
    expect(isIdentity(adj({ contrast: 1 }))).toBe(false);
  });

  it('leaves values untouched at zero', () => {
    const source = cell(37, 128, 219);
    expect(readSrgb(applyAdjustments(source, NO_ADJUSTMENTS))).toEqual([37, 128, 219]);
  });

  it('never mutates its input', () => {
    const source = cell(37, 128, 219);
    const before = [...source.data];
    applyAdjustments(source, adj({ brightness: 50, contrast: 50, saturation: -50 }));
    expect([...source.data]).toEqual(before);
  });

  it('preserves grid dimensions', () => {
    const buffer: CellBuffer = { cols: 3, rows: 2, data: new Float32Array(18).fill(0.5) };
    const out = applyAdjustments(buffer, adj({ contrast: 20 }));
    expect(out.cols).toBe(3);
    expect(out.rows).toBe(2);
    expect(out.data).toHaveLength(18);
  });
});

describe('brightness', () => {
  it('reaches white at +100 and black at -100', () => {
    expect(
      readSrgb(applyAdjustments(cell(90, 120, 40), adj({ brightness: 100 })))
    ).toEqual([255, 255, 255]);
    expect(
      readSrgb(applyAdjustments(cell(90, 120, 40), adj({ brightness: -100 })))
    ).toEqual([0, 0, 0]);
  });

  it('is monotonic', () => {
    const values = [-60, -30, 0, 30, 60].map(
      (brightness) =>
        readSrgb(applyAdjustments(cell(128, 128, 128), adj({ brightness })))[0]
    );
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
  });

  /**
   * Lifting toward white rather than adding a flat offset means the endpoints
   * stay pinned, so highlights do not blow out the moment the slider moves.
   */
  it('leaves pure white and pure black pinned', () => {
    expect(
      readSrgb(applyAdjustments(cell(255, 255, 255), adj({ brightness: 50 })))
    ).toEqual([255, 255, 255]);
    expect(readSrgb(applyAdjustments(cell(0, 0, 0), adj({ brightness: -50 })))).toEqual([
      0, 0, 0,
    ]);
  });
});

describe('contrast', () => {
  it('flattens everything to mid-gray at -100', () => {
    for (const c of [
      [0, 0, 0],
      [255, 255, 255],
      [200, 40, 90],
    ]) {
      expect(
        readSrgb(applyAdjustments(cell(c[0]!, c[1]!, c[2]!), adj({ contrast: -100 })))
      ).toEqual([128, 128, 128]);
    }
  });

  it('pushes values away from mid-gray at +100', () => {
    expect(
      readSrgb(applyAdjustments(cell(160, 160, 160), adj({ contrast: 100 })))[0]
    ).toBeGreaterThan(160);
    expect(
      readSrgb(applyAdjustments(cell(96, 96, 96), adj({ contrast: 100 })))[0]
    ).toBeLessThan(96);
  });

  it('leaves mid-gray fixed, since that is the pivot', () => {
    expect(
      readSrgb(applyAdjustments(cell(128, 128, 128), adj({ contrast: 80 })))
    ).toEqual([128, 128, 128]);
  });

  /**
   * The reason contrast runs in gamma space rather than linear light: the
   * perceptual mid-point is sRGB 128. Pivoting at linear 0.5 would sit at
   * sRGB 188, so a contrast boost would drag almost the whole image downward
   * into shadow instead of spreading it about the middle.
   */
  it('pivots on perceptual mid-gray, not linear 0.5', () => {
    const brighter = readSrgb(
      applyAdjustments(cell(188, 188, 188), adj({ contrast: 50 }))
    )[0];
    const darker = readSrgb(applyAdjustments(cell(68, 68, 68), adj({ contrast: 50 })))[0];
    expect(brighter).toBeGreaterThan(188);
    expect(darker).toBeLessThan(68);
  });
});

describe('saturation', () => {
  it('produces gray at -100', () => {
    const [r, g, b] = readSrgb(
      applyAdjustments(cell(200, 40, 90), adj({ saturation: -100 }))
    );
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('weights green most heavily, per Rec. 709', () => {
    const fromGreen = readSrgb(
      applyAdjustments(cell(0, 255, 0), adj({ saturation: -100 }))
    )[0];
    const fromBlue = readSrgb(
      applyAdjustments(cell(0, 0, 255), adj({ saturation: -100 }))
    )[0];
    expect(fromGreen).toBeGreaterThan(fromBlue);
  });

  it('increases the spread between channels at +100', () => {
    const source = cell(180, 120, 100);
    const before = readSrgb(applyAdjustments(source, NO_ADJUSTMENTS));
    const after = readSrgb(applyAdjustments(source, adj({ saturation: 100 })));
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(after)).toBeGreaterThan(spread(before));
  });

  it('leaves neutral colors neutral', () => {
    expect(
      readSrgb(applyAdjustments(cell(128, 128, 128), adj({ saturation: 100 })))
    ).toEqual([128, 128, 128]);
  });
});

describe('safety', () => {
  it('clamps every channel into range', () => {
    const extreme = applyAdjustments(
      cell(250, 10, 200),
      adj({ brightness: 90, contrast: 100, saturation: 100 })
    );
    for (const v of extreme.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('clamps out-of-range slider values rather than extrapolating', () => {
    const wild = readSrgb(
      applyAdjustments(cell(128, 128, 128), adj({ brightness: 500 }))
    );
    const pinned = readSrgb(
      applyAdjustments(cell(128, 128, 128), adj({ brightness: 100 }))
    );
    expect(wild).toEqual(pinned);
  });

  it('handles a multi-cell buffer element-wise', () => {
    const buffer: CellBuffer = {
      cols: 2,
      rows: 1,
      data: new Float32Array([
        srgbToLinear(0),
        srgbToLinear(0),
        srgbToLinear(0),
        srgbToLinear(1),
        srgbToLinear(1),
        srgbToLinear(1),
      ]),
    };
    const out = applyAdjustments(buffer, adj({ contrast: -100 }));
    expect(Math.round(linearToSrgb(out.data[0]!) * 255)).toBe(128);
    expect(Math.round(linearToSrgb(out.data[3]!) * 255)).toBe(128);
  });
});
