/**
 * Tiler dispatch. The two orientations are genuinely different problems
 * (DESIGN.md §7), so this routes rather than parameterizes.
 */
import { tileFlat, type FlatTileOptions } from './tile-flat';
import { tileWall, type WallTileOptions } from './tile-wall';
import { defaultInventoryFor } from './parts';
import type { Grid, LegoColor, Orientation, TilerWeights, Tiling } from './types';

export interface TileOptions {
  /** Defaults to the orientation's standard inventory. */
  inventory?: readonly string[];
  weights?: TilerWeights;
  seed?: number;
  strict?: boolean;
  colors?: readonly LegoColor[];
  /** Pips-out only. */
  restarts?: number;
  /** Pips-out only. */
  budgetMs?: number;
  /** Pips-up only. */
  staggerLookback?: readonly number[];
  onProgress?: (fraction: number) => void;
  /** Pips-out only: abandon the restart search early. See `FlatTileOptions`. */
  shouldAbort?: () => boolean;
}

export function tile(
  grid: Grid,
  orientation: Orientation,
  options: TileOptions = {}
): Tiling {
  const inventory = options.inventory ?? defaultInventoryFor(orientation);

  if (orientation === 'pips-out') {
    const flat: FlatTileOptions = { inventory };
    if (options.weights) flat.weights = options.weights;
    if (options.seed !== undefined) flat.seed = options.seed;
    if (options.restarts !== undefined) flat.restarts = options.restarts;
    if (options.budgetMs !== undefined) flat.budgetMs = options.budgetMs;
    if (options.strict !== undefined) flat.strict = options.strict;
    if (options.colors) flat.colors = options.colors;
    if (options.onProgress) flat.onProgress = options.onProgress;
    if (options.shouldAbort) flat.shouldAbort = options.shouldAbort;
    return tileFlat(grid, flat);
  }

  const wall: WallTileOptions = { inventory };
  if (options.weights) wall.weights = options.weights;
  if (options.seed !== undefined) wall.seed = options.seed;
  if (options.strict !== undefined) wall.strict = options.strict;
  if (options.colors) wall.colors = options.colors;
  if (options.staggerLookback) wall.staggerLookback = options.staggerLookback;
  if (options.onProgress) wall.onProgress = options.onProgress;
  return tileWall(grid, wall);
}

/** Piece count if every cell were its own 1x1, for the "vs 1x1" comparison. */
export const naivePieceCount = (grid: Grid): number => grid.cols * grid.rows;
