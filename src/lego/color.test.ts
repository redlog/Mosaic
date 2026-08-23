import { describe, expect, it } from 'vitest';
import {
  darkenLab,
  deltaE2000,
  hexToRgb,
  isValidHex,
  labToRgb,
  linearToSrgb,
  rgbToHex,
  rgbToLab,
  srgbToLinear,
} from './color';

describe('sRGB transfer function', () => {
  it('pins the endpoints', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
  });

  it('round-trips', () => {
    for (let i = 0; i <= 255; i++) {
      const c = i / 255;
      expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 10);
    }
  });

  it('uses the piecewise curve, not pow(c, 2.2)', () => {
    // Mid-gray is the clearest separator: the real curve gives ~0.2140,
    // the 2.2 approximation gives ~0.2176.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140411, 6);
    expect(srgbToLinear(0.5)).not.toBeCloseTo(Math.pow(0.5, 2.2), 4);
  });

  it('is linear in the toe, where the approximation diverges most', () => {
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 12);
  });

  /**
   * The property the whole downsampling stage rests on: an equal mix of black
   * and white is linear 0.5, which is sRGB ~188 — not the 128 you get from
   * averaging gamma-encoded values. See DESIGN.md §6.2.
   */
  it('puts a 50/50 black-and-white mix at sRGB 188, not 128', () => {
    const mix = (srgbToLinear(0) + srgbToLinear(1)) / 2;
    expect(mix).toBeCloseTo(0.5, 12);
    expect(Math.round(linearToSrgb(mix) * 255)).toBe(188);
  });
});

describe('Lab conversion', () => {
  it('maps reference colors to their published values', () => {
    const cases: Array<[string, [number, number, number]]> = [
      ['#FFFFFF', [100, 0, 0]],
      ['#000000', [0, 0, 0]],
      ['#808080', [53.585, 0, 0]],
      ['#FF0000', [53.2408, 80.0925, 67.2032]],
      ['#00FF00', [87.7347, -86.1827, 83.1793]],
      ['#0000FF', [32.297, 79.1875, -107.8602]],
    ];
    for (const [hex, [l, a, b]] of cases) {
      const lab = rgbToLab(hexToRgb(hex));
      expect(lab[0]).toBeCloseTo(l, 2);
      expect(lab[1]).toBeCloseTo(a, 2);
      expect(lab[2]).toBeCloseTo(b, 2);
    }
  });

  it('round-trips every gray exactly', () => {
    for (let i = 0; i <= 255; i++) {
      expect(labToRgb(rgbToLab([i, i, i]))).toEqual([i, i, i]);
    }
  });

  it('round-trips saturated colors within a quantization step', () => {
    const samples: Array<[number, number, number]> = [
      [201, 26, 9],
      [0, 85, 191],
      [35, 120, 65],
      [242, 205, 55],
      [88, 42, 18],
    ];
    for (const rgb of samples) {
      const back = labToRgb(rgbToLab(rgb));
      for (let ch = 0; ch < 3; ch++) {
        expect(Math.abs(back[ch]! - rgb[ch]!)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('deltaE2000 basics', () => {
  it('is zero for identical colors', () => {
    expect(deltaE2000([50, 10, -20], [50, 10, -20])).toBe(0);
  });

  it('grows with separation', () => {
    const base: [number, number, number] = [50, 0, 0];
    const near = deltaE2000(base, [52, 0, 0]);
    const far = deltaE2000(base, [70, 0, 0]);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('separates near-neutrals that plain Lab distance would confuse', () => {
    // Two colors equidistant in raw Lab but perceptually very different:
    // chroma differences near the neutral axis read much larger than
    // lightness differences of the same numeric size.
    const gray: [number, number, number] = [50, 0, 0];
    expect(deltaE2000(gray, [50, 5, 0])).toBeGreaterThan(deltaE2000(gray, [55, 0, 0]));
  });
});

describe('hex handling', () => {
  it('parses 6-digit and 3-digit forms, with or without #', () => {
    expect(hexToRgb('#FF8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#F80')).toEqual([255, 136, 0]);
  });

  it('rejects malformed values', () => {
    for (const bad of ['', '#', '#12345', 'ggg', '#1234567', 'rgb(1,2,3)']) {
      expect(isValidHex(bad)).toBe(false);
      expect(() => hexToRgb(bad)).toThrow();
    }
  });

  it('round-trips through rgbToHex', () => {
    for (const hex of ['#000000', '#FFFFFF', '#C91A09', '#05131D', '#E4CD9E']) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    }
  });
});

describe('darkenLab', () => {
  it('leaves the color alone at 0 and reaches black at 1', () => {
    const red = hexToRgb('#C91A09');
    expect(darkenLab(red, 0)).toEqual(red);
    expect(darkenLab(red, 1)).toEqual([0, 0, 0]);
  });

  it('lowers lightness monotonically', () => {
    const blue = hexToRgb('#0055BF');
    const l = (rgb: readonly [number, number, number]) => rgbToLab(rgb)[0];
    expect(l(darkenLab(blue, 0.15))).toBeLessThan(l(blue));
    expect(l(darkenLab(blue, 0.4))).toBeLessThan(l(darkenLab(blue, 0.15)));
  });

  it('clamps out-of-range amounts instead of producing nonsense', () => {
    const green = hexToRgb('#237841');
    expect(darkenLab(green, -1)).toEqual(green);
    expect(darkenLab(green, 5)).toEqual([0, 0, 0]);
  });
});
