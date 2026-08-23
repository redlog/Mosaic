import type { Orientation } from './types';

/** Center-to-center stud spacing. */
export const STUD_PITCH_MM = 8.0;
/** Height of a standard brick — exactly 1.2 x the stud pitch. */
export const BRICK_HEIGHT_MM = 9.6;
/** Height of a plate. Unused in v1; defined so the ratio is on record. */
export const PLATE_HEIGHT_MM = 3.2;
export const MM_PER_INCH = 25.4;

/** Studs along one edge of a standard large baseplate. */
export const BASEPLATE_STUDS = 48;

export const mmToIn = (mm: number): number => mm / MM_PER_INCH;
export const mmToCm = (mm: number): number => mm / 10;

/**
 * Size of one grid cell in millimetres.
 *
 * The asymmetry is the whole reason the two orientations differ: laid flat,
 * a cell is the square top of a stud; stood up in a wall, it is the side face
 * of a brick, which is taller than it is wide.
 */
export function cellSize(orientation: Orientation): { w: number; h: number } {
  return orientation === 'pips-out'
    ? { w: STUD_PITCH_MM, h: STUD_PITCH_MM }
    : { w: STUD_PITCH_MM, h: BRICK_HEIGHT_MM };
}

/**
 * Aspect ratio (width / height) of the finished mosaic for a given grid.
 *
 * Crop framing must use this rather than `cols / rows`, or a `pips-up` mosaic
 * comes out vertically squashed — see DESIGN.md §2.4a.
 */
export function mosaicAspect(
  cols: number,
  rows: number,
  orientation: Orientation
): number {
  const cell = cellSize(orientation);
  return (cols * cell.w) / (rows * cell.h);
}

export interface FinishedSize {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  widthIn: number;
  heightIn: number;
  widthCm: number;
  heightCm: number;
  studs: number;
}

/** Physical size of a finished mosaic, excluding any baseplate thickness. */
export function finishedSize(
  cols: number,
  rows: number,
  orientation: Orientation
): FinishedSize {
  const cell = cellSize(orientation);
  const widthMm = cols * cell.w;
  const heightMm = rows * cell.h;
  return {
    widthMm,
    heightMm,
    depthMm: BRICK_HEIGHT_MM,
    widthIn: mmToIn(widthMm),
    heightIn: mmToIn(heightMm),
    widthCm: mmToCm(widthMm),
    heightCm: mmToCm(heightMm),
    studs: cols * rows,
  };
}

export interface BaseplateCoverage {
  across: number;
  down: number;
  total: number;
}

/**
 * Baseplates needed to back a `pips-out` mosaic. Meaningless for `pips-up`,
 * which is a freestanding wall.
 */
export function baseplatesFor(
  cols: number,
  rows: number,
  studsPerPlate = BASEPLATE_STUDS
): BaseplateCoverage {
  const across = Math.ceil(cols / studsPerPlate);
  const down = Math.ceil(rows / studsPerPlate);
  return { across, down, total: across * down };
}

/** Largest grid we will attempt, per dimension. */
export const MAX_GRID_DIMENSION = 400;
/** Above this, the UI warns that tiling will be slow. */
export const WARN_GRID_DIMENSION = 256;
/** Smallest grid that produces anything recognisable. */
export const MIN_GRID_DIMENSION = 8;
