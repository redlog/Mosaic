import { describe, expect, it } from 'vitest';
import { deltaE2000 } from './color';

/**
 * Supplementary test data from:
 *
 *   G. Sharma, W. Wu, E. N. Dalal, "The CIEDE2000 Color-Difference Formula:
 *   Implementation Notes, Supplementary Test Data, and Mathematical
 *   Observations", Color Research and Application, 30(1):21-30, 2005.
 *
 * This is the standard conformance suite for CIEDE2000, and the reason it
 * exists is that the formula has three separate conditional branches around
 * the hue-angle discontinuity. An implementation that gets them wrong still
 * returns entirely plausible numbers for ordinary colors and only diverges on
 * adversarial pairs — which is precisely what pairs 1-24 below are.
 *
 * Pairs 1-6 stress the arctangent quadrant, 7-8 symmetry, 9-15 the hue-mean
 * branch at near-zero chroma (note 0.0009 / 0.0010 / 0.0011 flipping the
 * result), 16-24 the G and T terms, and 25-34 are ordinary color pairs.
 *
 * Columns: L1, a1, b1, L2, a2, b2, expected ΔE00.
 */
const SHARMA_PAIRS: ReadonlyArray<
  readonly [number, number, number, number, number, number, number]
> = [
  [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
  [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
  [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
  [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -1.1848, -84.8006, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -0.9009, -85.5211, 50.0, 0.0, -82.7485, 1.0],
  [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
  [50.0, -1.0, 2.0, 50.0, 0.0, 0.0, 2.3669],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.001, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0012, 7.2195],
  [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.001, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
  [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
  [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
  [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
  [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.903],
  [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
  [50.0, 2.5, 0.0, 50.0, 3.1736, 0.5854, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2972, 0.0, 1.0],
  [50.0, 2.5, 0.0, 50.0, 1.8634, 0.5757, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2592, 0.335, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
];

describe('deltaE2000 — Sharma/Wu/Dalal conformance', () => {
  it('has all 34 reference pairs', () => {
    expect(SHARMA_PAIRS).toHaveLength(34);
  });

  it.each(SHARMA_PAIRS.map((p, i) => [i + 1, p] as const))(
    'pair %i',
    (_n, [l1, a1, b1, l2, a2, b2, expected]) => {
      expect(deltaE2000([l1, a1, b1], [l2, a2, b2])).toBeCloseTo(expected, 4);
    }
  );

  it('is symmetric across every reference pair', () => {
    for (const [l1, a1, b1, l2, a2, b2] of SHARMA_PAIRS) {
      const forward = deltaE2000([l1, a1, b1], [l2, a2, b2]);
      const backward = deltaE2000([l2, a2, b2], [l1, a1, b1]);
      expect(backward).toBeCloseTo(forward, 10);
    }
  });
});
