/**
 * Shared machinery for both tilers: the owner map, seam detection, the
 * objective function, and the invariant checker every tiler test reuses.
 */
import { SHAPES_BY_ID, orientationsOf } from './parts';
import { legalShapes } from './palette';
import type {
  Grid,
  LegoColor,
  Orientation,
  Placement,
  TilerWeights,
  Tiling,
} from './types';

/** Pips-out defaults. Aligned seams are only an appearance problem here. */
export const DEFAULT_WEIGHTS: TilerWeights = {
  pieces: 1.0,
  ones: 0.5,
  seam: 0.25,
};

/**
 * Pips-up defaults. Seams carry double the weight they do laid flat, because
 * in a wall they are structural rather than cosmetic.
 *
 * The number is forced by a specific case. A 32-wide run has exactly one
 * minimum-piece tiling — 8+8+8+8 — so seams at columns 8, 16 and 24 are
 * unavoidable at four pieces, and breaking the bond costs a fifth. At the flat
 * weight of 0.25 those three aligned seams cost 0.75 against the 1.0 of an
 * extra brick, so the tiler stacks them into a continuous vertical crack all
 * the way up the wall. At 0.5 the arithmetic reverses (1.5 > 1.0) and the bond
 * breaks. Measured cost of the change on a solid 32-wide wall: about 6% more
 * pieces, in exchange for the wall staying in one piece.
 */
export const DEFAULT_WALL_WEIGHTS: TilerWeights = {
  pieces: 1.0,
  ones: 0.5,
  seam: 0.5,
};

/** Marks a cell no placement has claimed. */
export const UNOWNED = -1;

/**
 * One placement index per cell, row-major. `UNOWNED` where nothing sits.
 * Int32 rather than Int16 because a 400x400 grid of 1x1s exceeds 32767 pieces.
 */
export function buildOwnerMap(
  cols: number,
  rows: number,
  placements: readonly Placement[]
): Int32Array {
  const owner = new Int32Array(cols * rows).fill(UNOWNED);
  for (let p = 0; p < placements.length; p++) {
    const { col, row, w, h } = placements[p]!;
    for (let r = row; r < row + h; r++) {
      const base = r * cols;
      for (let c = col; c < col + w; c++) owner[base + c] = p;
    }
  }
  return owner;
}

/**
 * Count four-corner junctions: interior lattice points where four *different*
 * bricks meet.
 *
 * The same test serves both orientations, which is a happy accident of the
 * geometry. Laid flat it finds the `+` crossings that look noisy and interlock
 * poorly. In a wall, four distinct bricks can only meet at a point when a
 * vertical seam in one course lines up with a seam in the course above — which
 * is precisely the continuous fracture line that makes a one-stud-deep wall
 * come apart.
 */
export function countAlignedSeams(cols: number, rows: number, owner: Int32Array): number {
  let junctions = 0;
  for (let row = 1; row < rows; row++) {
    const above = (row - 1) * cols;
    const here = row * cols;
    for (let col = 1; col < cols; col++) {
      const a = owner[above + col - 1]!;
      const b = owner[above + col]!;
      const c = owner[here + col - 1]!;
      const d = owner[here + col]!;
      if (a !== b && a !== c && a !== d && b !== c && b !== d && c !== d) {
        junctions++;
      }
    }
  }
  return junctions;
}

export function countOnes(placements: readonly Placement[]): number {
  let ones = 0;
  for (const p of placements) if (p.w === 1 && p.h === 1) ones++;
  return ones;
}

/**
 * The objective both tilers minimize.
 *
 * Piece count stands in for cost. It is not a perfect proxy — a 2x8 costs more
 * than a 1x1 — but real per-part prices vary by color and seller and are not
 * available offline, which is exactly why the BrickLink export exists.
 */
export function scoreTiling(
  placements: readonly Placement[],
  alignedSeams: number,
  weights: TilerWeights = DEFAULT_WEIGHTS
): number {
  return (
    weights.pieces * placements.length +
    weights.ones * countOnes(placements) +
    weights.seam * alignedSeams
  );
}

export interface ValidateOptions {
  grid: Grid;
  inventory: readonly string[];
  /** When true, every placement's shape must exist in its color. */
  strict?: boolean;
  /** Required when `strict`; indexed by `Placement.colorIdx`. */
  colors?: readonly LegoColor[];
}

/**
 * Check every invariant a tiling must hold (DESIGN.md §7.4). Returns a list of
 * problems, empty when the tiling is sound.
 *
 * Shared by both tilers' test suites so neither can drift from the contract.
 */
export function validateTiling(tiling: Tiling, options: ValidateOptions): string[] {
  const problems: string[] = [];
  const { grid, inventory, strict = false, colors } = options;
  const { cols, rows, placements, orientation } = tiling;

  if (grid.cols !== cols || grid.rows !== rows) {
    problems.push(`Tiling is ${cols}x${rows} but the grid is ${grid.cols}x${grid.rows}`);
    return problems;
  }

  if (strict && !colors) {
    problems.push('Strict availability requested but no palette supplied');
    return problems;
  }

  const inventorySet = new Set(inventory);
  const covered = new Int32Array(cols * rows).fill(UNOWNED);

  for (let p = 0; p < placements.length; p++) {
    const placement = placements[p]!;
    const { designId, col, row, w, h, colorIdx } = placement;
    const label = `placement ${p} (${designId} at ${col},${row})`;

    // 3. Shape is in the active inventory.
    const shape = SHAPES_BY_ID.get(designId);
    if (!shape) {
      problems.push(`${label} has an unknown design ID`);
      continue;
    }
    if (!inventorySet.has(designId)) {
      problems.push(`${label} uses a shape outside the inventory`);
    }

    // Placed dimensions must be one of the shape's real footprints.
    const footprints = orientationsOf(shape);
    if (!footprints.some(([fw, fh]) => fw === w && fh === h)) {
      problems.push(`${label} is placed ${w}x${h}, which ${designId} cannot be`);
    }

    // 5. A wall brick occupies exactly one course.
    if (orientation === 'pips-up' && h !== 1) {
      problems.push(`${label} spans ${h} courses; wall bricks are one course tall`);
    }

    if (col < 0 || row < 0 || col + w > cols || row + h > rows) {
      problems.push(`${label} extends outside the grid`);
      continue;
    }

    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        const i = r * cols + c;

        // 1. No overlaps.
        if (covered[i] !== UNOWNED) {
          problems.push(`${label} overlaps placement ${covered[i]} at ${c},${r}`);
        }
        covered[i] = p;

        // 2. Monochrome.
        if (grid.colors[i] !== colorIdx) {
          problems.push(
            `${label} claims color ${colorIdx} but cell ${c},${r} is ${grid.colors[i]}`
          );
        }
      }
    }

    // 4. Legal for this color under strict availability.
    if (strict && colors) {
      const color = colors[colorIdx];
      if (!color) {
        problems.push(
          `${label} references color index ${colorIdx}, which does not exist`
        );
      } else if (!legalShapes(color, inventory, true).includes(designId)) {
        problems.push(
          `${label} uses ${designId}, which is not produced in ${color.name}`
        );
      }
    }
  }

  // 1. No gaps.
  let uncovered = 0;
  for (let i = 0; i < covered.length; i++) if (covered[i] === UNOWNED) uncovered++;
  if (uncovered > 0) {
    problems.push(`${uncovered} of ${covered.length} cells are not covered`);
  }

  return problems;
}

/** A shape as it can actually be laid down, one entry per legal rotation. */
export interface Footprint {
  designId: string;
  w: number;
  h: number;
  area: number;
}

/**
 * Expand an inventory into placeable footprints.
 *
 * In a wall this keeps only single-course shapes and their one orientation —
 * a 1x4 laid on its side would be a brick standing on end, which is not a
 * thing this build technique does.
 */
export function expandFootprints(
  inventory: readonly string[],
  orientation: Orientation
): Footprint[] {
  const out: Footprint[] = [];
  for (const designId of inventory) {
    const shape = SHAPES_BY_ID.get(designId);
    if (!shape) continue;
    if (orientation === 'pips-up') {
      if (shape.h !== 1) continue;
      out.push({ designId, w: shape.w, h: 1, area: shape.w });
      continue;
    }
    for (const [w, h] of orientationsOf(shape)) {
      out.push({ designId, w, h, area: w * h });
    }
  }
  return out;
}

/**
 * A 1x1 must be available for every color in play, or some region may be
 * impossible to cover — an inventory of only 1x2 cannot tile an odd-length
 * run. Checked up front so the failure names the cause instead of surfacing
 * as mysterious uncovered cells.
 */
export function assertCoverable(
  grid: Grid,
  inventory: readonly string[],
  strict: boolean,
  colors?: readonly LegoColor[]
): void {
  if (!inventory.includes('3005')) {
    throw new Error(
      'Inventory must include the 1x1 brick (3005): without it some regions cannot be covered'
    );
  }
  if (!strict || !colors) return;

  const used = new Set(grid.colors);
  for (const colorIdx of used) {
    const color = colors[colorIdx];
    if (!color)
      throw new Error(`Grid references color index ${colorIdx}, which does not exist`);
    if (!color.shapes.includes('3005')) {
      throw new Error(
        `${color.name} is not produced as a 1x1 brick, so this mosaic cannot be tiled ` +
          'under strict availability — disable that color or turn strict off'
      );
    }
  }
}
