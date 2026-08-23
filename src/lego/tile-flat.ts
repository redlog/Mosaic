/**
 * Pips-out tiler: cover a colored grid with as few, as large, and as
 * pleasingly-offset bricks as possible.
 *
 * The mosaic sits on a baseplate, which carries all the load, so structure is
 * free and this is purely a cost-and-appearance problem.
 *
 * Exact minimum tiling of an arbitrary polyomino by a restricted set of
 * rectangles is NP-hard, so this is deliberately a heuristic: greedy
 * largest-first placement, repeated from many randomized starting points, best
 * result kept. On an inventory this small that lands close to optimal, and it
 * degrades gracefully — the time budget cuts the trial count rather than
 * freezing the tab.
 */
import { mulberry32 } from './rng';
import {
  DEFAULT_WEIGHTS,
  UNOWNED,
  assertCoverable,
  buildOwnerMap,
  countAlignedSeams,
  countOnes,
  expandFootprints,
  scoreTiling,
  type Footprint,
} from './score';
import type { Grid, LegoColor, Placement, TilerWeights, Tiling } from './types';

export interface FlatTileOptions {
  inventory: readonly string[];
  weights?: TilerWeights;
  seed?: number;
  /** Upper bound on randomized restarts; the time budget may cut it short. */
  restarts?: number;
  /** Wall-clock budget in milliseconds. */
  budgetMs?: number;
  strict?: boolean;
  /** Required when `strict`; indexed by the grid's color indices. */
  colors?: readonly LegoColor[];
  onProgress?: (fraction: number) => void;
}

export const DEFAULT_RESTARTS = 200;
export const DEFAULT_BUDGET_MS = 1500;

/**
 * Sort footprints largest-area first, shuffling ties.
 *
 * The tie-shuffle matters more than it looks: a 2x4 and a 1x8 both cover eight
 * cells, and which one gets first refusal changes the whole downstream
 * packing. Varying it across trials is a cheap source of real diversity.
 */
function orderFootprints(
  footprints: readonly Footprint[],
  rng: ReturnType<typeof mulberry32>
): Footprint[] {
  const byArea = new Map<number, Footprint[]>();
  for (const fp of footprints) {
    const bucket = byArea.get(fp.area);
    if (bucket) bucket.push(fp);
    else byArea.set(fp.area, [fp]);
  }
  return [...byArea.keys()]
    .sort((a, b) => b - a)
    .flatMap((area) => rng.shuffle(byArea.get(area)!));
}

/** Can this footprint sit here — all cells free, all one color? */
function fits(
  colors: Int16Array,
  owner: Int32Array,
  cols: number,
  col: number,
  row: number,
  w: number,
  h: number,
  colorIdx: number
): boolean {
  for (let r = row; r < row + h; r++) {
    const base = r * cols;
    for (let c = col; c < col + w; c++) {
      const i = base + c;
      if (owner[i] !== UNOWNED || colors[i] !== colorIdx) return false;
    }
  }
  return true;
}

export function tileFlat(grid: Grid, options: FlatTileOptions): Tiling {
  const started = performance.now();
  const { cols, rows } = grid;
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const strict = options.strict ?? false;
  const seed = options.seed ?? 1;
  const maxTrials = Math.max(1, options.restarts ?? DEFAULT_RESTARTS);
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;

  assertCoverable(grid, options.inventory, strict, options.colors);

  const footprints = expandFootprints(options.inventory, 'pips-out');
  if (footprints.length === 0) throw new Error('Inventory is empty');

  // Precompute legality per (color, footprint) so the inner loop is a lookup
  // rather than a set membership test.
  const colorCount = options.colors?.length ?? 0;
  const allowed =
    strict && options.colors
      ? (() => {
          const table = new Uint8Array(colorCount * footprints.length);
          for (let ci = 0; ci < colorCount; ci++) {
            const available = new Set(options.colors![ci]!.shapes);
            for (let fi = 0; fi < footprints.length; fi++) {
              table[ci * footprints.length + fi] = available.has(footprints[fi]!.designId)
                ? 1
                : 0;
            }
          }
          return table;
        })()
      : null;

  const cellCount = cols * rows;
  let best: Placement[] | null = null;
  let bestScore = Infinity;
  let bestSeams = 0;
  let trials = 0;

  for (let trial = 0; trial < maxTrials; trial++) {
    const rng = mulberry32(seed + trial * 0x9e3779b9);
    const owner = new Int32Array(cellCount).fill(UNOWNED);
    const placements: Placement[] = [];
    const order = orderFootprints(footprints, rng);

    // A randomized scan origin and axis, so trials explore genuinely different
    // packings rather than the same one with different tie-breaks.
    const offset = rng.int(cellCount);
    const columnMajor = rng.bool();

    for (const fp of order) {
      const fi = footprints.indexOf(fp);
      const { w, h, designId } = fp;
      const maxCol = cols - w;
      const maxRow = rows - h;
      if (maxCol < 0 || maxRow < 0) continue;

      for (let k = 0; k < cellCount; k++) {
        const scan = (k + offset) % cellCount;
        const col = columnMajor ? Math.floor(scan / rows) : scan % cols;
        const row = columnMajor ? scan % rows : Math.floor(scan / cols);
        if (col > maxCol || row > maxRow) continue;

        const head = row * cols + col;
        if (owner[head] !== UNOWNED) continue;

        const colorIdx = grid.colors[head]!;
        if (allowed && allowed[colorIdx * footprints.length + fi] === 0) continue;
        if (!fits(grid.colors, owner, cols, col, row, w, h, colorIdx)) continue;

        const index = placements.length;
        placements.push({ designId, col, row, w, h, colorIdx });
        for (let r = row; r < row + h; r++) {
          const base = r * cols;
          for (let c = col; c < col + w; c++) owner[base + c] = index;
        }
      }
    }

    trials++;

    let uncovered = 0;
    for (let i = 0; i < cellCount; i++) if (owner[i] === UNOWNED) uncovered++;
    if (uncovered > 0) {
      // assertCoverable guarantees a 1x1 exists, so this is unreachable
      // short of a bug. Fail loudly rather than returning a holed mosaic.
      throw new Error(`Tiler left ${uncovered} cells uncovered`);
    }

    const seams = countAlignedSeams(cols, rows, owner);
    const score = scoreTiling(placements, seams, weights);
    if (score < bestScore) {
      bestScore = score;
      best = placements;
      bestSeams = seams;
    }

    options.onProgress?.((trial + 1) / maxTrials);
    if (performance.now() - started > budgetMs) break;
  }

  const placements = best ?? [];
  return {
    orientation: 'pips-out',
    cols,
    rows,
    placements,
    stats: {
      pieces: placements.length,
      ones: countOnes(placements),
      alignedSeams: bestSeams,
      score: bestScore,
      seed,
      trials,
      elapsedMs: performance.now() - started,
    },
  };
}

/** Re-derive the owner map for a finished tiling, for rendering and hit-testing. */
export function ownerMapFor(tiling: Tiling): Int32Array {
  return buildOwnerMap(tiling.cols, tiling.rows, tiling.placements);
}
