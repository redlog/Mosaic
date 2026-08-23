import type { Lab, Rgb } from './color';

/**
 * Which way the bricks face. These are two different physical constructions,
 * not two aspect ratios — see DESIGN.md §2.1.
 *
 * - `pips-out`: studs face the viewer, bricks lie flat on a baseplate.
 *   Cells are square and bricks tile a plane in either rotation.
 * - `pips-up`: studs face the ceiling, the mosaic is a wall viewed edge-on.
 *   Cells are 5:6 and bricks span horizontally within a single course.
 */
export type Orientation = 'pips-out' | 'pips-up';

/** A brick, identified by its LEGO/BrickLink design ID. */
export interface BrickShape {
  /** Design ID, e.g. "3001" for Brick 2 x 4. */
  designId: string;
  /** Human-readable name, e.g. "Brick 2 x 4". */
  name: string;
  /** Studs along the long axis. */
  w: number;
  /** Studs along the short axis. Always 1 for shapes usable in a wall. */
  h: number;
  /**
   * Whether this shape is stocked widely enough to be on by default.
   * The long bricks (1x10 and up) are real but pricier per stud and thin
   * in color coverage, so they ship disabled.
   */
  common: boolean;
}

/** A palette entry exactly as it appears in `palette.data.json`. */
export interface PaletteColorData {
  /** Stable slug used as the identity everywhere else, e.g. "dark-turquoise". */
  key: string;
  name: string;
  /** "#RRGGBB". */
  hex: string;
  /**
   * BrickLink color ID, required to emit this color in a Wanted List.
   * `null` means unknown — such colors are excluded from XML export rather
   * than guessed, because a wrong ID produces a silently wrong order.
   */
  blColorId: number | null;
  /**
   * Design IDs this color is actually produced in. This is per-shape, not a
   * single availability flag, because plenty of colors exist as a 1x2 but
   * not as a 2x8 — see DESIGN.md §5.2.
   */
  shapes: string[];
}

/** A palette entry after loading, with color spaces precomputed. */
export interface LegoColor extends PaletteColorData {
  rgb: Rgb;
  lab: Lab;
}

/** Where a palette's data came from, and whether anyone checked it. */
export interface PaletteProvenance {
  source: string;
  /** ISO date the data was produced. */
  generated: string;
  /**
   * False means the values are a best-effort starting point, not verified
   * against current production. The UI surfaces this.
   */
  verified: boolean;
  note: string;
}

/** The raw shape of `palette.data.json`. */
export interface PaletteFile {
  id: string;
  provenance: PaletteProvenance;
  colors: PaletteColorData[];
}

/** Decoded source pixels: RGBA, 8-bit, row-major. */
export interface SourceImage {
  width: number;
  height: number;
  /** Length is `width * height * 4`. */
  data: Uint8ClampedArray;
}

/**
 * Crop rectangle in normalized source coordinates (0-1).
 *
 * Normalized rather than in pixels so it survives a change of source
 * resolution and serializes into a project file unambiguously.
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/** Orientation fixes applied before cropping. Rotation is clockwise. */
export interface Transform {
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
}

/**
 * The downsampled mosaic before quantization: one linear-light RGB triple per
 * cell, row-major. Linear rather than sRGB because every averaging operation
 * upstream of this depends on it (DESIGN.md §6.2).
 */
export interface CellBuffer {
  cols: number;
  rows: number;
  /** Length is `cols * rows * 3`, channels in 0-1. */
  data: Float32Array;
}

/** Image adjustments, each -100 to +100, 0 being no change. */
export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
}

/**
 * A quantized mosaic: one palette index per cell, row-major.
 * `-1` marks a cell with no assigned color, which should not survive
 * quantization but is representable so intermediate states are expressible.
 */
export interface Grid {
  cols: number;
  rows: number;
  colors: Int16Array;
}

/** One brick placed at a position, already resolved to its final rotation. */
export interface Placement {
  designId: string;
  /** Column of the top-left cell. */
  col: number;
  /** Row of the top-left cell. */
  row: number;
  /** Width in cells as placed, after any rotation. */
  w: number;
  /** Height in cells as placed. Always 1 in `pips-up`. */
  h: number;
  /** Index into the palette used to build the grid. */
  colorIdx: number;
}

export interface TilingStats {
  pieces: number;
  /** Count of 1x1 bricks. High counts mean an expensive, fiddly build. */
  ones: number;
  /**
   * Aligned seams: four-corner junctions in `pips-out`, stacked course seams
   * in `pips-up`. Cosmetic in the former, structural in the latter.
   */
  alignedSeams: number;
  score: number;
  seed: number;
  /** Restarts actually run, which the time budget may cut short. */
  trials: number;
  elapsedMs: number;
}

export interface Tiling {
  orientation: Orientation;
  cols: number;
  rows: number;
  placements: Placement[];
  stats: TilingStats;
}

/** Objective weights shared by both tilers. See DESIGN.md §7. */
export interface TilerWeights {
  pieces: number;
  ones: number;
  seam: number;
}

export interface BomLine {
  designId: string;
  partName: string;
  colorKey: string;
  colorName: string;
  blColorId: number | null;
  quantity: number;
}
