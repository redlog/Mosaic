/**
 * Project files: one JSON document holding everything needed to reopen a
 * mosaic (DESIGN.md §10).
 *
 * Three decisions shape this format:
 *
 * 1. **The quantized grid is always stored.** RLE'd it is a few kilobytes, and
 *    it means a project always opens into something meaningful even when the
 *    source image was left out.
 * 2. **The source image is optional.** Embedding makes the file self-contained
 *    and fully re-editable; it also turns a 12-megapixel photo into a ~15 MB
 *    JSON file, so it can be dropped.
 * 3. **The tiling is never stored.** It is fully determined by the grid plus
 *    the tiler settings and seed, so it is recomputed on load. That keeps files
 *    small and makes it impossible for a stored tiling to disagree with the
 *    settings that supposedly produced it.
 */
import { hasShape } from './parts';
import { isValidHex } from './color';
import type {
  Adjustments,
  CropRect,
  Grid,
  Orientation,
  TilerWeights,
  Transform,
} from './types';
import type { DitherMode } from './quantize';

export const PROJECT_FORMAT = 'lego-mosaic-project';
export const PROJECT_VERSION = 1;
export const PROJECT_MIME = 'application/json';

/** Run-length pairs: `[colorIndex, runLength]`, row-major over the grid. */
export type RleRun = [number, number];

export interface ProjectGrid {
  cols: number;
  rows: number;
  encoding: 'rle-v1';
  colorKeys: string[];
  data: RleRun[];
}

export interface ProjectSource {
  name: string;
  width: number;
  height: number;
  /** Omitted when the project was saved without its image. */
  dataUrl?: string;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  createdAt: string;
  app: { version: string };
  source?: ProjectSource;
  crop: CropRect;
  transform: Transform;
  mosaic: { orientation: Orientation; cols: number; rows: number };
  adjust: Adjustments;
  quantize: {
    dither: DitherMode;
    ditherStrength: number;
    maxColors: number | null;
    strictAvailability: boolean;
    enabledColors: string[];
  };
  tiler: {
    inventory: string[];
    weights: TilerWeights;
    restarts: number;
    seed: number;
  };
  palette: { id: string; overrides: Array<{ key: string; hex: string }> };
  grid: ProjectGrid;
}

// ---------------------------------------------------------------------------
// Run-length coding
// ---------------------------------------------------------------------------

export function encodeRle(indices: Int16Array): RleRun[] {
  const runs: RleRun[] = [];
  if (indices.length === 0) return runs;

  let value = indices[0]!;
  let length = 1;
  for (let i = 1; i < indices.length; i++) {
    const next = indices[i]!;
    if (next === value) {
      length++;
    } else {
      runs.push([value, length]);
      value = next;
      length = 1;
    }
  }
  runs.push([value, length]);
  return runs;
}

export function decodeRle(runs: readonly RleRun[], expected: number): Int16Array {
  const out = new Int16Array(expected);
  let at = 0;
  for (const run of runs) {
    if (!Array.isArray(run) || run.length !== 2) {
      throw new Error('Malformed run-length data in project grid');
    }
    const [value, length] = run;
    if (!Number.isInteger(length) || length < 0) {
      throw new Error(`Invalid run length ${length} in project grid`);
    }
    if (at + length > expected) {
      throw new Error('Project grid data is longer than its stated dimensions');
    }
    out.fill(value, at, at + length);
    at += length;
  }
  if (at !== expected) {
    throw new Error(`Project grid data covers ${at} cells but the grid is ${expected}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

/**
 * Structural validation. Deliberately strict about `format` and `version`: a
 * partially-understood project is worse than a refused one, because it opens
 * looking fine and is quietly wrong.
 */
export function validateProject(input: unknown): ProjectFile {
  if (typeof input !== 'object' || input === null) {
    throw new ProjectError('That file is not a Mosaic project.');
  }
  const file = input as Partial<ProjectFile>;

  if (file.format !== PROJECT_FORMAT) {
    throw new ProjectError('That file is not a Mosaic project.');
  }
  if (typeof file.version !== 'number' || !Number.isInteger(file.version)) {
    throw new ProjectError('Project file has no version number.');
  }
  if (file.version < 1) {
    throw new ProjectError(`Project version ${file.version} is not supported.`);
  }
  if (file.version > PROJECT_VERSION) {
    throw new ProjectError(
      `This project was saved by a newer version of Mosaic (format ${file.version}, this build reads ${PROJECT_VERSION}).`
    );
  }

  if (!file.grid || typeof file.grid !== 'object') {
    throw new ProjectError('Project file has no grid.');
  }
  const grid = file.grid;
  if (grid.encoding !== 'rle-v1') {
    throw new ProjectError(`Unknown grid encoding "${String(grid.encoding)}".`);
  }
  if (!Number.isInteger(grid.cols) || !Number.isInteger(grid.rows)) {
    throw new ProjectError('Project grid has invalid dimensions.');
  }
  if (!Array.isArray(grid.colorKeys) || grid.colorKeys.length === 0) {
    throw new ProjectError('Project grid has no color list.');
  }
  if (!Array.isArray(grid.data)) {
    throw new ProjectError('Project grid has no data.');
  }
  if (!file.mosaic || !file.crop || !file.tiler || !file.quantize) {
    throw new ProjectError('Project file is missing required settings.');
  }
  if (file.source?.dataUrl !== undefined && typeof file.source.dataUrl !== 'string') {
    throw new ProjectError('Project source image is malformed.');
  }
  for (const override of file.palette?.overrides ?? []) {
    if (typeof override?.hex !== 'string' || !isValidHex(override.hex)) {
      throw new ProjectError(`Palette override for "${override?.key}" has a bad color.`);
    }
  }
  for (const designId of file.tiler.inventory ?? []) {
    if (!hasShape(designId)) {
      throw new ProjectError(`Project references unknown brick "${designId}".`);
    }
  }

  return migrate(file as ProjectFile);
}

/**
 * Bring an older project up to the current shape. Nothing to do at version 1;
 * the chain exists so the first real migration has somewhere to go.
 */
function migrate(file: ProjectFile): ProjectFile {
  return file;
}

// ---------------------------------------------------------------------------
// Reading the grid back
// ---------------------------------------------------------------------------

export interface RestoredGrid {
  grid: Grid;
  colorKeys: string[];
}

export function readGrid(file: ProjectFile): RestoredGrid {
  const { cols, rows, data, colorKeys } = file.grid;
  const indices = decodeRle(data, cols * rows);
  for (const index of indices) {
    if (index < 0 || index >= colorKeys.length) {
      throw new ProjectError(
        `Project grid references color ${index}, but only ${colorKeys.length} are listed.`
      );
    }
  }
  return { grid: { cols, rows, colors: indices }, colorKeys: [...colorKeys] };
}

export const serializeProject = (file: ProjectFile): string =>
  JSON.stringify(file, null, 2);

export function parseProject(text: string): ProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectError('That file is not valid JSON.');
  }
  return validateProject(parsed);
}
