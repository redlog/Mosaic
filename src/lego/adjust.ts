/**
 * Brightness, contrast, and saturation for the cell buffer.
 *
 * These matter more than they sound. The LEGO palette is small and highly
 * saturated, so a flat photograph maps into a narrow band of bricks; a
 * contrast and saturation bump before quantizing often improves the result
 * more than any change to the matching algorithm.
 *
 * **Applied in gamma-encoded space, not linear light.** The rest of the
 * pipeline is linear because averaging demands it, but these three are
 * perceptual controls, and users expect them to behave the way every photo
 * editor behaves. A contrast pivot at linear 0.5 sits at sRGB 188 — nearly
 * white — so pushing contrast in linear light crushes the whole image into
 * shadow. Pivoting at sRGB 0.5 puts it on perceptual mid-gray where it
 * belongs. Rec. 709 luma coefficients are likewise defined on gamma-encoded
 * values, so saturation lands in the right space too.
 */
import { linearToSrgb, srgbToLinear } from './color';
import type { Adjustments, CellBuffer } from './types';

export const NO_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

/** Rec. 709 luma weights, for gamma-encoded R'G'B'. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function isIdentity(adj: Adjustments): boolean {
  return adj.brightness === 0 && adj.contrast === 0 && adj.saturation === 0;
}

/**
 * Apply adjustments, returning a new buffer.
 *
 * Order is brightness, then contrast, then saturation — exposure first, then
 * tonal range, then color, which is the order that keeps each control feeling
 * independent of the others.
 */
export function applyAdjustments(cells: CellBuffer, adj: Adjustments): CellBuffer {
  if (isIdentity(adj)) {
    return { cols: cells.cols, rows: cells.rows, data: new Float32Array(cells.data) };
  }

  const brightness = Math.max(-100, Math.min(100, adj.brightness)) / 100;
  const contrast = Math.max(-100, Math.min(100, adj.contrast)) / 100;
  const saturation = Math.max(-100, Math.min(100, adj.saturation)) / 100;

  // Contrast as a pivot scale about perceptual mid-gray: 0 flattens to gray,
  // 1 is unchanged, 2 doubles the spread.
  const contrastK = 1 + contrast;
  // Saturation as interpolation about luma: 0 is grayscale, 2 doubles chroma.
  const saturationK = 1 + saturation;

  const out = new Float32Array(cells.data.length);

  for (let i = 0; i < cells.data.length; i += 3) {
    let r = linearToSrgb(cells.data[i]!);
    let g = linearToSrgb(cells.data[i + 1]!);
    let b = linearToSrgb(cells.data[i + 2]!);

    if (brightness !== 0) {
      // Lifting toward white and pulling toward black, rather than a flat
      // offset: both ends stay pinned, so nothing clips until the extremes.
      if (brightness > 0) {
        r += brightness * (1 - r);
        g += brightness * (1 - g);
        b += brightness * (1 - b);
      } else {
        const k = 1 + brightness;
        r *= k;
        g *= k;
        b *= k;
      }
    }

    if (contrast !== 0) {
      r = (r - 0.5) * contrastK + 0.5;
      g = (g - 0.5) * contrastK + 0.5;
      b = (b - 0.5) * contrastK + 0.5;
    }

    if (saturation !== 0) {
      const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      r = luma + (r - luma) * saturationK;
      g = luma + (g - luma) * saturationK;
      b = luma + (b - luma) * saturationK;
    }

    out[i] = srgbToLinear(clamp01(r));
    out[i + 1] = srgbToLinear(clamp01(g));
    out[i + 2] = srgbToLinear(clamp01(b));
  }

  return { cols: cells.cols, rows: cells.rows, data: out };
}
