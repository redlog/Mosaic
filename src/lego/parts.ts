import type { BrickShape, Orientation } from './types';

/**
 * The brick catalog, keyed by LEGO/BrickLink design ID.
 *
 * Only standard solid bricks — no plates, tiles, or slopes (DESIGN.md §1.3).
 * `common: false` marks the long bricks, which are real parts but cost more
 * per stud and exist in far fewer colors, so they ship disabled.
 */
export const BRICK_SHAPES: readonly BrickShape[] = [
  { designId: '3005', name: 'Brick 1 x 1', w: 1, h: 1, common: true },
  { designId: '3004', name: 'Brick 1 x 2', w: 2, h: 1, common: true },
  { designId: '3622', name: 'Brick 1 x 3', w: 3, h: 1, common: true },
  { designId: '3010', name: 'Brick 1 x 4', w: 4, h: 1, common: true },
  { designId: '3009', name: 'Brick 1 x 6', w: 6, h: 1, common: true },
  { designId: '3008', name: 'Brick 1 x 8', w: 8, h: 1, common: true },
  { designId: '6111', name: 'Brick 1 x 10', w: 10, h: 1, common: false },
  { designId: '6112', name: 'Brick 1 x 12', w: 12, h: 1, common: false },
  { designId: '2465', name: 'Brick 1 x 16', w: 16, h: 1, common: false },
  { designId: '3003', name: 'Brick 2 x 2', w: 2, h: 2, common: true },
  { designId: '3002', name: 'Brick 2 x 3', w: 3, h: 2, common: true },
  { designId: '3001', name: 'Brick 2 x 4', w: 4, h: 2, common: true },
  { designId: '2456', name: 'Brick 2 x 6', w: 6, h: 2, common: true },
  { designId: '3007', name: 'Brick 2 x 8', w: 8, h: 2, common: true },
  { designId: '3006', name: 'Brick 2 x 10', w: 10, h: 2, common: false },
];

export const SHAPES_BY_ID: ReadonlyMap<string, BrickShape> = new Map(
  BRICK_SHAPES.map((s) => [s.designId, s])
);

export function getShape(designId: string): BrickShape {
  const shape = SHAPES_BY_ID.get(designId);
  if (!shape) throw new Error(`Unknown design ID: ${designId}`);
  return shape;
}

export function hasShape(designId: string): boolean {
  return SHAPES_BY_ID.has(designId);
}

export const area = (shape: BrickShape): number => shape.w * shape.h;

/**
 * The distinct footprints a shape can occupy. Square bricks have one; the
 * rest can be laid either way when tiling a plane.
 */
export function orientationsOf(shape: BrickShape): Array<[number, number]> {
  return shape.w === shape.h
    ? [[shape.w, shape.h]]
    : [
        [shape.w, shape.h],
        [shape.h, shape.w],
      ];
}

/**
 * Shapes usable in a `pips-up` wall: one course tall, spanning horizontally.
 * A brick is 9.6mm tall and that is that — nothing spans two courses.
 */
export const WALL_SHAPES: readonly BrickShape[] = BRICK_SHAPES.filter((s) => s.h === 1);

export const DEFAULT_FLAT_INVENTORY: readonly string[] = BRICK_SHAPES.filter(
  (s) => s.common
).map((s) => s.designId);

/**
 * Wall default excludes 2xN entirely. A 2x4 presents the same face as a 1x4
 * but makes the wall two studs deep — double the cost for no visual change.
 */
export const DEFAULT_WALL_INVENTORY: readonly string[] = WALL_SHAPES.filter(
  (s) => s.common
).map((s) => s.designId);

export function defaultInventoryFor(orientation: Orientation): readonly string[] {
  return orientation === 'pips-out' ? DEFAULT_FLAT_INVENTORY : DEFAULT_WALL_INVENTORY;
}

/** Every shape legal in this orientation, whether or not it is on by default. */
export function availableShapesFor(orientation: Orientation): readonly BrickShape[] {
  return orientation === 'pips-out' ? BRICK_SHAPES : WALL_SHAPES;
}

/** Distinct horizontal run lengths available in a wall, ascending. */
export function wallLengths(inventory: readonly string[]): number[] {
  const lengths = new Set<number>();
  for (const id of inventory) {
    const shape = SHAPES_BY_ID.get(id);
    if (shape && shape.h === 1) lengths.add(shape.w);
  }
  return [...lengths].sort((a, b) => a - b);
}

/** The 1xN shape covering a given run length, if the inventory has one. */
export function wallShapeOfLength(
  length: number,
  inventory: readonly string[]
): BrickShape | undefined {
  for (const id of inventory) {
    const shape = SHAPES_BY_ID.get(id);
    if (shape && shape.h === 1 && shape.w === length) return shape;
  }
  return undefined;
}
