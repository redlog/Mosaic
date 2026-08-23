/**
 * The heavy half of the pipeline — quantize, then tile — as one pure function.
 *
 * Extracted so the worker and the synchronous fallback run *identical* code,
 * and so it can be tested in Node without a worker at all. The worker in
 * src/worker/ is a thin message-passing shell around this.
 */
import { enabledColors, loadPalette, unusableColors } from './palette';
import { quantize, type DitherMode } from './quantize';
import { tile } from './tile';
import type {
  Grid,
  CellBuffer,
  LegoColor,
  Orientation,
  TilerWeights,
  Tiling,
} from './types';

/** One shared palette instance; loading is cheap but not free. */
export const palette = loadPalette();

export interface BuildSettings {
  orientation: Orientation;
  /** Palette keys the user has switched on. */
  colorKeys: string[];
  dither: DitherMode;
  ditherStrength: number;
  maxColors: number | null;
  strict: boolean;
  inventory: string[];
  weights: TilerWeights;
  seed: number;
  restarts: number;
  budgetMs: number;
}

export interface BuildResult {
  grid: Grid;
  /** Palette keys the grid's indices refer to, in index order. */
  colorKeys: string[];
  counts: number[];
  tiling: Tiling;
}

export type BuildPhase = 'quantize' | 'tile';
export type ProgressFn = (phase: BuildPhase, fraction: number) => void;
/**
 * Consulted during the tiling search; true abandons it and returns the best
 * result so far. Lets a caller stop paying for an answer it no longer wants.
 */
export type AbortFn = () => boolean;

/**
 * The enabled colors, minus any the inventory cannot actually build.
 *
 * Under strict availability a color with no legal brick — or with legal bricks
 * but no 1x1, which real catalog data does produce — would fail partway
 * through tiling with a cell nothing can cover. Dropping such colors here
 * rather than in the UI means every caller gets the guarantee, worker and
 * headless test alike. If that would empty the palette the enabled set is
 * passed through unchanged, so the failure is the one the user can act on
 * ("nothing you picked is buildable") instead of "enable at least one color".
 */
function resolve(settings: Pick<BuildSettings, 'colorKeys' | 'strict' | 'inventory'>) {
  const enabled = enabledColors(palette, settings.colorKeys);
  if (enabled.length === 0) {
    throw new Error('Enable at least one color to build a mosaic');
  }
  if (!settings.strict) return enabled;

  const unusable = new Set(unusableColors(enabled, settings.inventory).map((c) => c.key));
  const usable = enabled.filter((c) => !unusable.has(c.key));
  return usable.length > 0 ? usable : enabled;
}

/** Quantize a cell buffer, then tile the result. */
export function buildFromCells(
  cells: CellBuffer,
  settings: BuildSettings,
  onProgress?: ProgressFn,
  shouldAbort?: AbortFn
): BuildResult {
  onProgress?.('quantize', 0);
  const quantized = quantize(cells, resolve(settings), {
    dither: settings.dither,
    ditherStrength: settings.ditherStrength,
    maxColors: settings.maxColors,
  });
  onProgress?.('quantize', 1);

  return {
    ...tileGrid(quantized.grid, quantized.colors, settings, onProgress, shouldAbort),
    counts: quantized.counts,
  };
}

/**
 * Tile a grid that already exists — the path taken when a project file was
 * saved without its source image (DESIGN.md §10.1).
 */
export function buildFromGrid(
  grid: Grid,
  colorKeys: readonly string[],
  settings: BuildSettings,
  onProgress?: ProgressFn,
  shouldAbort?: AbortFn
): BuildResult {
  const colors = colorKeys.map((key) => {
    const color = palette.byKey.get(key);
    if (!color) throw new Error(`Project references unknown color "${key}"`);
    return color;
  });

  const counts = new Array<number>(colors.length).fill(0);
  for (const index of grid.colors) {
    if (index >= 0 && index < counts.length) counts[index]!++;
  }

  return { ...tileGrid(grid, colors, settings, onProgress, shouldAbort), counts };
}

function tileGrid(
  grid: Grid,
  colors: readonly LegoColor[],
  settings: BuildSettings,
  onProgress?: ProgressFn,
  shouldAbort?: AbortFn
): Omit<BuildResult, 'counts'> {
  const tiling = tile(grid, settings.orientation, {
    inventory: settings.inventory,
    weights: settings.weights,
    seed: settings.seed,
    restarts: settings.restarts,
    budgetMs: settings.budgetMs,
    strict: settings.strict,
    colors,
    ...(onProgress ? { onProgress: (f: number) => onProgress('tile', f) } : {}),
    ...(shouldAbort ? { shouldAbort } : {}),
  });

  return { grid, colorKeys: colors.map((c) => c.key), tiling };
}
