/**
 * Map each cell to the nearest available LEGO color.
 *
 * Matching is by CIEDE2000 in Lab. Dithering is available but off by default,
 * because it works directly against the point of the tiler: error diffusion
 * deliberately breaks flat regions into alternating colors, which is exactly
 * the pattern that cannot be merged into large bricks. A dithered mosaic can
 * easily be three to four times the piece count and almost all 1x1s.
 */
import { deltaE2000, linearRgbToLab, rgb255ToLinear } from './color';
import type { CellBuffer, Grid, LegoColor } from './types';

export type DitherMode = 'none' | 'floyd-steinberg';

export interface QuantizeOptions {
  dither?: DitherMode;
  /** 0-1. Scales the diffused error; 0 is identical to `dither: 'none'`. */
  ditherStrength?: number;
  /**
   * Cap on distinct colors. Sourcing twelve colors is far cheaper and simpler
   * than sourcing forty, so this is a real cost lever, not just a stylistic
   * one. `null` or `undefined` means no cap.
   */
  maxColors?: number | null;
}

export interface QuantizeResult {
  grid: Grid;
  /** The colors the grid's indices refer to — reduced if `maxColors` applied. */
  colors: LegoColor[];
  /** Cell count per color, parallel to `colors`. Feeds the palette panel. */
  counts: number[];
}

/** Palette data arranged for the inner loop. */
interface Prepared {
  lab: Float64Array; // 3 per color
  linear: Float64Array; // 3 per color
  count: number;
}

function prepare(colors: readonly LegoColor[]): Prepared {
  const n = colors.length;
  const lab = new Float64Array(n * 3);
  const linear = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = colors[i]!;
    lab[i * 3] = c.lab[0];
    lab[i * 3 + 1] = c.lab[1];
    lab[i * 3 + 2] = c.lab[2];
    const lin = rgb255ToLinear(c.rgb);
    linear[i * 3] = lin[0];
    linear[i * 3 + 1] = lin[1];
    linear[i * 3 + 2] = lin[2];
  }
  return { lab, linear, count: n };
}

function nearest(prepared: Prepared, l: number, a: number, b: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < prepared.count; i++) {
    const d = deltaE2000(
      [l, a, b],
      [prepared.lab[i * 3]!, prepared.lab[i * 3 + 1]!, prepared.lab[i * 3 + 2]!]
    );
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** How many bins per channel the color-reduction histogram uses. */
const HISTOGRAM_BITS = 5;
/** Cap on histogram entries fed to the greedy selector, heaviest first. */
const MAX_REPRESENTATIVES = 2048;

/**
 * Choose the `n` palette colors that best represent this image.
 *
 * Greedy: repeatedly take the color that most reduces the total weighted
 * distance from every cell to its closest chosen color. Cells are first
 * collapsed into a coarse histogram so the cost is bounded by the number of
 * distinct color regions rather than the number of cells.
 */
export function selectColors(
  cells: CellBuffer,
  colors: readonly LegoColor[],
  n: number
): LegoColor[] {
  if (n >= colors.length) return [...colors];
  if (n <= 0) return [];

  const shift = 8 - HISTOGRAM_BITS;
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();

  for (let i = 0; i < cells.data.length; i += 3) {
    const r = cells.data[i]!;
    const g = cells.data[i + 1]!;
    const b = cells.data[i + 2]!;
    // Bin on a cheap linear quantization; only used to group similar cells.
    const key =
      ((Math.min(255, (r * 255) | 0) >> shift) << (HISTOGRAM_BITS * 2)) |
      ((Math.min(255, (g * 255) | 0) >> shift) << HISTOGRAM_BITS) |
      (Math.min(255, (b * 255) | 0) >> shift);
    const bin = bins.get(key);
    if (bin) {
      bin.count++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    } else {
      bins.set(key, { count: 1, r, g, b });
    }
  }

  const reps = [...bins.values()]
    .sort((p, q) => q.count - p.count)
    .slice(0, MAX_REPRESENTATIVES)
    .map((bin) => ({
      weight: bin.count,
      lab: linearRgbToLab([bin.r / bin.count, bin.g / bin.count, bin.b / bin.count]),
    }));

  // Precompute every representative-to-color distance once; the greedy loop
  // then only reads from this table.
  const dist = new Float64Array(reps.length * colors.length);
  for (let ri = 0; ri < reps.length; ri++) {
    for (let ci = 0; ci < colors.length; ci++) {
      dist[ri * colors.length + ci] = deltaE2000(reps[ri]!.lab, colors[ci]!.lab);
    }
  }

  const chosen: number[] = [];
  const taken = new Uint8Array(colors.length);
  const bestSoFar = new Float64Array(reps.length).fill(Infinity);

  for (let k = 0; k < n; k++) {
    let bestColor = -1;
    let bestCost = Infinity;
    for (let ci = 0; ci < colors.length; ci++) {
      if (taken[ci]) continue;
      let cost = 0;
      for (let ri = 0; ri < reps.length; ri++) {
        const d = dist[ri * colors.length + ci]!;
        cost += Math.min(bestSoFar[ri]!, d) * reps[ri]!.weight;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestColor = ci;
      }
    }
    if (bestColor < 0) break;
    taken[bestColor] = 1;
    chosen.push(bestColor);
    for (let ri = 0; ri < reps.length; ri++) {
      const d = dist[ri * colors.length + bestColor]!;
      if (d < bestSoFar[ri]!) bestSoFar[ri] = d;
    }
  }

  // Return in palette order rather than selection order, so the UI list stays
  // stable as the cap changes.
  return chosen.sort((p, q) => p - q).map((i) => colors[i]!);
}

export function quantize(
  cells: CellBuffer,
  colors: readonly LegoColor[],
  options: QuantizeOptions = {}
): QuantizeResult {
  if (colors.length === 0) {
    throw new Error('Cannot quantize with an empty palette — enable at least one color');
  }

  const strength = Math.max(0, Math.min(1, options.ditherStrength ?? 0));
  const dithering = options.dither === 'floyd-steinberg' && strength > 0;

  const active =
    options.maxColors != null && options.maxColors < colors.length
      ? selectColors(cells, colors, options.maxColors)
      : [...colors];
  const prepared = prepare(active);

  const { cols, rows } = cells;
  const indices = new Int16Array(cols * rows);
  const counts = new Array<number>(active.length).fill(0);

  if (!dithering) {
    // Flat regions repeat the same color many times over, so an 8-bit cache
    // saves most of the Lab conversions and distance scans on real images.
    const cache = new Map<number, number>();
    for (let cell = 0; cell < indices.length; cell++) {
      const i = cell * 3;
      const r = cells.data[i]!;
      const g = cells.data[i + 1]!;
      const b = cells.data[i + 2]!;
      const key =
        (Math.min(255, Math.max(0, Math.round(r * 255))) << 16) |
        (Math.min(255, Math.max(0, Math.round(g * 255))) << 8) |
        Math.min(255, Math.max(0, Math.round(b * 255)));

      let idx = cache.get(key);
      if (idx === undefined) {
        const lab = linearRgbToLab([r, g, b]);
        idx = nearest(prepared, lab[0], lab[1], lab[2]);
        cache.set(key, idx);
      }
      indices[cell] = idx;
      counts[idx]!++;
    }
    return { grid: { cols, rows, colors: indices }, colors: active, counts };
  }

  // Floyd-Steinberg, serpentine, with error accumulated in linear light —
  // which is where spatial mixing actually happens when you stand back from
  // the finished mosaic.
  const work = new Float64Array(cells.data);

  for (let row = 0; row < rows; row++) {
    const leftToRight = row % 2 === 0;
    for (let step = 0; step < cols; step++) {
      const col = leftToRight ? step : cols - 1 - step;
      const i = (row * cols + col) * 3;

      const r = work[i]!;
      const g = work[i + 1]!;
      const b = work[i + 2]!;
      const lab = linearRgbToLab([r, g, b]);
      const idx = nearest(prepared, lab[0], lab[1], lab[2]);
      indices[row * cols + col] = idx;
      counts[idx]!++;

      const errR = (r - prepared.linear[idx * 3]!) * strength;
      const errG = (g - prepared.linear[idx * 3 + 1]!) * strength;
      const errB = (b - prepared.linear[idx * 3 + 2]!) * strength;

      const ahead = leftToRight ? 1 : -1;
      const spread = (dc: number, dr: number, weight: number): void => {
        const c = col + dc;
        const rr = row + dr;
        if (c < 0 || c >= cols || rr >= rows) return;
        const j = (rr * cols + c) * 3;
        work[j] = work[j]! + errR * weight;
        work[j + 1] = work[j + 1]! + errG * weight;
        work[j + 2] = work[j + 2]! + errB * weight;
      };

      spread(ahead, 0, 7 / 16);
      spread(-ahead, 1, 3 / 16);
      spread(0, 1, 5 / 16);
      spread(ahead, 1, 1 / 16);
    }
  }

  return { grid: { cols, rows, colors: indices }, colors: active, counts };
}
