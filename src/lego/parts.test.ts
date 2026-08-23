import { describe, expect, it } from 'vitest';
import {
  BRICK_SHAPES,
  DEFAULT_FLAT_INVENTORY,
  DEFAULT_WALL_INVENTORY,
  SHAPES_BY_ID,
  WALL_SHAPES,
  area,
  availableShapesFor,
  defaultInventoryFor,
  getShape,
  hasShape,
  orientationsOf,
  wallLengths,
  wallShapeOfLength,
} from './parts';

describe('brick catalog', () => {
  it('has no duplicate design IDs', () => {
    const ids = BRICK_SHAPES.map((s) => s.designId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('indexes every shape by ID', () => {
    expect(SHAPES_BY_ID.size).toBe(BRICK_SHAPES.length);
    for (const s of BRICK_SHAPES) {
      expect(SHAPES_BY_ID.get(s.designId)).toBe(s);
    }
  });

  it('stores dimensions long-axis first', () => {
    for (const s of BRICK_SHAPES) {
      expect(s.w).toBeGreaterThanOrEqual(s.h);
      expect(s.h).toBeGreaterThanOrEqual(1);
    }
  });

  it('names every shape consistently with its dimensions', () => {
    for (const s of BRICK_SHAPES) {
      expect(s.name).toBe(`Brick ${s.h} x ${s.w}`);
    }
  });

  it('throws on an unknown ID rather than returning undefined', () => {
    expect(hasShape('3001')).toBe(true);
    expect(hasShape('9999')).toBe(false);
    expect(() => getShape('9999')).toThrow(/Unknown design ID/);
  });

  it('computes area', () => {
    expect(area(getShape('3005'))).toBe(1);
    expect(area(getShape('3001'))).toBe(8);
    expect(area(getShape('3007'))).toBe(16);
  });
});

describe('orientationsOf', () => {
  it('gives squares one footprint and rectangles two', () => {
    expect(orientationsOf(getShape('3005'))).toEqual([[1, 1]]);
    expect(orientationsOf(getShape('3003'))).toEqual([[2, 2]]);
    expect(orientationsOf(getShape('3001'))).toEqual([
      [4, 2],
      [2, 4],
    ]);
  });
});

describe('wall inventory', () => {
  /**
   * The invariant behind the whole pips-up tiler: a brick is one course tall,
   * so nothing with h > 1 can appear in a wall.
   */
  it('contains only single-course shapes', () => {
    for (const s of WALL_SHAPES) expect(s.h).toBe(1);
    for (const id of DEFAULT_WALL_INVENTORY) expect(getShape(id).h).toBe(1);
  });

  it('excludes 2xN bricks, which add depth and cost but no visual change', () => {
    expect(DEFAULT_WALL_INVENTORY).not.toContain('3003');
    expect(DEFAULT_WALL_INVENTORY).not.toContain('3001');
  });

  it('defaults to 1x1 through 1x8, leaving the long bricks off', () => {
    expect(DEFAULT_WALL_INVENTORY).toEqual([
      '3005',
      '3004',
      '3622',
      '3010',
      '3009',
      '3008',
    ]);
  });

  it('derives sorted, distinct run lengths', () => {
    expect(wallLengths(DEFAULT_WALL_INVENTORY)).toEqual([1, 2, 3, 4, 6, 8]);
    expect(wallLengths(['3005', '3004', '3005'])).toEqual([1, 2]);
  });

  it('ignores 2xN shapes when deriving run lengths', () => {
    expect(wallLengths(['3005', '3001', '3003'])).toEqual([1]);
  });

  it('resolves a run length back to its shape', () => {
    expect(wallShapeOfLength(4, DEFAULT_WALL_INVENTORY)?.designId).toBe('3010');
    expect(wallShapeOfLength(5, DEFAULT_WALL_INVENTORY)).toBeUndefined();
  });
});

describe('flat inventory', () => {
  it('is the whole catalog', () => {
    expect(DEFAULT_FLAT_INVENTORY).toEqual(BRICK_SHAPES.map((s) => s.designId));
  });

  it('carries both 1xN and 2xN', () => {
    expect(DEFAULT_FLAT_INVENTORY).toContain('3008');
    expect(DEFAULT_FLAT_INVENTORY).toContain('3001');
  });
});

describe('catalog', () => {
  // The palette's per-shape availability is generated against exactly these
  // eleven; a shape added here without rebuilding the palette would be legal
  // in no color at all under strict availability.
  it('is the 1xN and 2xN bricks up to eight studs', () => {
    expect(BRICK_SHAPES.map((s) => s.designId)).toEqual([
      '3005',
      '3004',
      '3622',
      '3010',
      '3009',
      '3008',
      '3003',
      '3002',
      '3001',
      '2456',
      '3007',
    ]);
    for (const shape of BRICK_SHAPES) {
      expect(shape.h === 1 || shape.h === 2).toBe(true);
      expect(shape.w).toBeLessThanOrEqual(8);
      expect(shape.name).toBe(`Brick ${shape.h} x ${shape.w}`);
    }
  });
});

describe('orientation dispatch', () => {
  it('routes defaults and availability by orientation', () => {
    expect(defaultInventoryFor('pips-out')).toBe(DEFAULT_FLAT_INVENTORY);
    expect(defaultInventoryFor('pips-up')).toBe(DEFAULT_WALL_INVENTORY);
    expect(availableShapesFor('pips-out')).toBe(BRICK_SHAPES);
    expect(availableShapesFor('pips-up')).toBe(WALL_SHAPES);
  });

  it('never offers a multi-course shape for a wall', () => {
    for (const s of availableShapesFor('pips-up')) expect(s.h).toBe(1);
  });
});
