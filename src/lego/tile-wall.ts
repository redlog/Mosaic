/**
 * Pips-up tiler: lay a stacked wall, one course of bricks per image row.
 *
 * A brick is 9.6mm tall and nothing spans two courses, so within a course a
 * run of same-colored cells has to be partitioned into available 1xN lengths.
 * That is coin change, which a DP solves exactly.
 *
 * The useful part is that the seam penalty folds into the DP state at no extra
 * cost, so running bond falls out of the optimization rather than being bolted
 * on as a post-pass. In a wall one stud deep, staggering is not decoration —
 * a seam that repeats up the courses is a continuous fracture line.
 */
import {
  DEFAULT_WALL_WEIGHTS,
  assertCoverable,
  buildOwnerMap,
  countAlignedSeams,
  countOnes,
  scoreTiling,
} from './score';
import { SHAPES_BY_ID, wallLengths } from './parts';
import { legalShapes } from './palette';
import type { Grid, LegoColor, Placement, TilerWeights, Tiling } from './types';

export interface WallTileOptions {
  inventory: readonly string[];
  weights?: TilerWeights;
  strict?: boolean;
  /** Required when `strict`; indexed by the grid's color indices. */
  colors?: readonly LegoColor[];
  /**
   * How far back to look when penalizing aligned seams, and how much each
   * course counts. Default weights two courses, the nearer one more heavily.
   */
  staggerLookback?: readonly number[];
  seed?: number;
  onProgress?: (fraction: number) => void;
}

/**
 * Looking back only one course still lets a seam reappear every *other*
 * course, which is a real fracture line. Two courses with a decaying weight
 * closes that without over-constraining the DP.
 */
export const DEFAULT_STAGGER_LOOKBACK: readonly number[] = [1.0, 0.4];

export function tileWall(grid: Grid, options: WallTileOptions): Tiling {
  const started = performance.now();
  const { cols, rows } = grid;
  const weights = options.weights ?? DEFAULT_WALL_WEIGHTS;
  const strict = options.strict ?? false;
  const lookback = options.staggerLookback ?? DEFAULT_STAGGER_LOOKBACK;

  assertCoverable(grid, options.inventory, strict, options.colors);

  const allLengths = wallLengths(options.inventory);
  if (allLengths.length === 0) {
    throw new Error('Inventory contains no single-course (1xN) bricks');
  }

  // Per-color legal run lengths, resolved once.
  const lengthsFor = new Map<number, number[]>();
  const shapeOfLength = new Map<number, string>();
  for (const id of options.inventory) {
    const shape = SHAPES_BY_ID.get(id);
    if (shape && shape.h === 1 && !shapeOfLength.has(shape.w)) {
      shapeOfLength.set(shape.w, id);
    }
  }
  const legalLengths = (colorIdx: number): number[] => {
    const cached = lengthsFor.get(colorIdx);
    if (cached) return cached;
    let lengths = allLengths;
    if (strict && options.colors) {
      const color = options.colors[colorIdx];
      if (!color) throw new Error(`Grid references unknown color index ${colorIdx}`);
      lengths = wallLengths(legalShapes(color, options.inventory, true));
    }
    // Longest first: ties in the DP then resolve toward fewer, larger bricks.
    const ordered = [...lengths].sort((a, b) => b - a);
    lengthsFor.set(colorIdx, ordered);
    return ordered;
  };

  const placements: Placement[] = [];

  // Seam columns for recently completed courses, nearest first. A color change
  // counts as a seam even though the DP never charges for it: two bricks
  // genuinely meet there, so the course above should still avoid lining up.
  const history: Array<Set<number>> = [];

  const seamPenalty = (col: number): number => {
    let penalty = 0;
    for (let k = 0; k < lookback.length && k < history.length; k++) {
      if (history[k]!.has(col)) penalty += lookback[k]!;
    }
    return penalty;
  };

  // Bottom-up, matching the order the wall actually gets built in.
  for (let row = rows - 1; row >= 0; row--) {
    const seams = new Set<number>();
    const base = row * cols;

    let runStart = 0;
    while (runStart < cols) {
      const colorIdx = grid.colors[base + runStart]!;
      let runEnd = runStart + 1;
      while (runEnd < cols && grid.colors[base + runEnd] === colorIdx) runEnd++;

      const runLength = runEnd - runStart;
      const lengths = legalLengths(colorIdx);

      // dp[i] is the best cost to cover the first i cells of this run.
      const dp = new Float64Array(runLength + 1).fill(Infinity);
      const choice = new Int32Array(runLength + 1).fill(-1);
      dp[0] = 0;

      for (let i = 1; i <= runLength; i++) {
        for (const length of lengths) {
          if (length > i) continue;
          const previous = dp[i - length]!;
          if (previous === Infinity) continue;

          let cost = previous + weights.pieces;
          if (length === 1) cost += weights.ones;
          // A boundary at the end of the run is forced by the color change, so
          // charging for it would only add a constant to every option.
          if (i < runLength) cost += weights.seam * seamPenalty(runStart + i);

          if (cost < dp[i]!) {
            dp[i] = cost;
            choice[i] = length;
          }
        }
      }

      if (dp[runLength] === Infinity) {
        throw new Error(
          `No combination of available brick lengths covers a run of ${runLength} cells`
        );
      }

      // Walk the choices back, then emit left to right.
      const chosen: number[] = [];
      for (let i = runLength; i > 0; i -= choice[i]!) chosen.push(choice[i]!);
      chosen.reverse();

      let col = runStart;
      for (const length of chosen) {
        placements.push({
          designId: shapeOfLength.get(length)!,
          col,
          row,
          w: length,
          h: 1,
          colorIdx,
        });
        col += length;
        if (col < cols) seams.add(col);
      }

      runStart = runEnd;
    }

    history.unshift(seams);
    if (history.length > lookback.length) history.length = lookback.length;

    options.onProgress?.((rows - row) / rows);
  }

  const owner = buildOwnerMap(cols, rows, placements);
  const alignedSeams = countAlignedSeams(cols, rows, owner);

  return {
    orientation: 'pips-up',
    cols,
    rows,
    placements,
    stats: {
      pieces: placements.length,
      ones: countOnes(placements),
      alignedSeams,
      score: scoreTiling(placements, alignedSeams, weights),
      seed: options.seed ?? 0,
      trials: 1,
      elapsedMs: performance.now() - started,
    },
  };
}
