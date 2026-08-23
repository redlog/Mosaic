import { describe, expect, it } from 'vitest';
import { tile, naivePieceCount } from './tile';
import { tileFlat } from './tile-flat';
import { tileWall } from './tile-wall';
import { countAlignedSeams, buildOwnerMap, validateTiling } from './score';
import { DEFAULT_FLAT_INVENTORY, DEFAULT_WALL_INVENTORY } from './parts';
import { loadPalette } from './palette';
import { mulberry32 } from './rng';
import type { Grid, Orientation, Tiling } from './types';

const palette = loadPalette();
const colors = [...palette.colors];

/** A grid from a per-cell color-index function. */
function grid(
  cols: number,
  rows: number,
  at: (col: number, row: number) => number
): Grid {
  const data = new Int16Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) data[row * cols + col] = at(col, row);
  }
  return { cols, rows, colors: data };
}

const solid = (cols: number, rows: number, colorIdx = 0): Grid =>
  grid(cols, rows, () => colorIdx);

/** Grids that stress a tiler in different ways. */
const corpus: Array<{ name: string; grid: Grid }> = [
  { name: 'single cell', grid: solid(1, 1) },
  { name: 'solid 8x8', grid: solid(8, 8) },
  { name: 'solid 32x24', grid: solid(32, 24) },
  { name: 'checkerboard', grid: grid(16, 16, (c, r) => (c + r) % 2) },
  { name: 'vertical stripes', grid: grid(16, 16, (c) => c % 3) },
  { name: 'horizontal stripes', grid: grid(16, 16, (_c, r) => r % 3) },
  { name: 'thin 1-wide column', grid: grid(1, 20, (_c, r) => r % 2) },
  { name: 'thin 1-tall row', grid: grid(20, 1, (c) => c % 2) },
  {
    name: 'one-cell islands',
    grid: grid(15, 15, (c, r) => (c % 4 === 2 && r % 4 === 2 ? 1 : 0)),
  },
  { name: 'diagonal', grid: grid(20, 20, (c, r) => (c === r ? 1 : 0)) },
  {
    name: 'nested blocks',
    grid: grid(24, 24, (c, r) => (c > 5 && c < 18 && r > 5 && r < 18 ? 1 : 0)),
  },
  {
    name: 'pseudorandom noise',
    grid: (() => {
      const rng = mulberry32(4242);
      return grid(24, 24, () => rng.int(5));
    })(),
  },
  {
    name: 'photo-like regions',
    grid: grid(40, 40, (c, r) => {
      if (r < 12) return 0;
      if (r < 20) return 1;
      if ((c - 28) ** 2 + (r - 8) ** 2 < 36) return 2;
      return 3;
    }),
  },
];

const check = (tiling: Tiling, g: Grid, inventory: readonly string[], strict = false) =>
  validateTiling(tiling, { grid: g, inventory, strict, colors });

// ---------------------------------------------------------------------------

describe.each([
  ['pips-out', DEFAULT_FLAT_INVENTORY],
  ['pips-up', DEFAULT_WALL_INVENTORY],
] as const)('%s invariants', (orientation, inventory) => {
  it.each(corpus.map((c) => [c.name, c.grid] as const))(
    'holds every invariant on %s',
    (_name, g) => {
      const tiling = tile(g, orientation as Orientation, {
        inventory,
        seed: 7,
        restarts: 12,
      });
      expect(check(tiling, g, inventory)).toEqual([]);
    }
  );

  it('covers every cell exactly once', () => {
    const g = corpus[12]!.grid;
    const tiling = tile(g, orientation as Orientation, { inventory, restarts: 8 });
    const owner = buildOwnerMap(g.cols, g.rows, tiling.placements);
    expect([...owner].every((o) => o >= 0)).toBe(true);
    const area = tiling.placements.reduce((sum, p) => sum + p.w * p.h, 0);
    expect(area).toBe(g.cols * g.rows);
  });

  it('reports stats consistent with its own placements', () => {
    const g = corpus[12]!.grid;
    const tiling = tile(g, orientation as Orientation, { inventory, restarts: 8 });
    expect(tiling.stats.pieces).toBe(tiling.placements.length);
    expect(tiling.stats.ones).toBe(
      tiling.placements.filter((p) => p.w === 1 && p.h === 1).length
    );
    expect(tiling.stats.alignedSeams).toBe(
      countAlignedSeams(g.cols, g.rows, buildOwnerMap(g.cols, g.rows, tiling.placements))
    );
    expect(tiling.orientation).toBe(orientation);
  });

  it('is deterministic for a given seed', () => {
    const g = corpus[11]!.grid;
    const a = tile(g, orientation as Orientation, { inventory, seed: 99, restarts: 20 });
    const b = tile(g, orientation as Orientation, { inventory, seed: 99, restarts: 20 });
    expect(a.placements).toEqual(b.placements);
  });

  it('respects strict availability', () => {
    // Dark Turquoise is not produced in the larger bricks.
    const turquoise = colors.findIndex((c) => c.key === 'dark-turquoise');
    expect(turquoise).toBeGreaterThanOrEqual(0);
    const g = solid(16, 16, turquoise);
    const tiling = tile(g, orientation as Orientation, {
      inventory,
      strict: true,
      colors,
      restarts: 8,
    });
    expect(check(tiling, g, inventory, true)).toEqual([]);
    for (const p of tiling.placements) {
      expect(colors[turquoise]!.shapes).toContain(p.designId);
    }
  });

  it('merges flat regions into far fewer pieces than 1x1s', () => {
    const g = solid(32, 32);
    const tiling = tile(g, orientation as Orientation, { inventory, restarts: 20 });
    expect(tiling.stats.pieces).toBeLessThan(naivePieceCount(g) / 4);
    expect(tiling.stats.ones).toBe(0);
  });

  it('falls back to 1x1s only where it must', () => {
    const g = grid(16, 16, (c, r) => (c + r) % 2); // checkerboard: nothing merges
    const tiling = tile(g, orientation as Orientation, { inventory, restarts: 8 });
    expect(tiling.stats.pieces).toBe(256);
    expect(tiling.stats.ones).toBe(256);
  });

  it('refuses an inventory without the 1x1, naming the reason', () => {
    const withoutOnes = inventory.filter((id) => id !== '3005');
    expect(() =>
      tile(solid(8, 8), orientation as Orientation, { inventory: withoutOnes })
    ).toThrow(/1x1/);
  });
});

// ---------------------------------------------------------------------------

describe('pips-out tiler', () => {
  const inventory = DEFAULT_FLAT_INVENTORY;

  /**
   * 64 cells, and a 2x8 covers 16 of them, so four pieces is the theoretical
   * floor. The tiler reaches it.
   */
  it('tiles a solid 8x8 in the optimal 4 pieces, all 2x8s', () => {
    const g = solid(8, 8);
    const tiling = tileFlat(g, { inventory, seed: 1, restarts: 50 });
    expect(tiling.stats.pieces).toBe(4);
    expect(new Set(tiling.placements.map((p) => p.designId))).toEqual(new Set(['3007']));
  });

  it('uses both rotations of a rectangular brick', () => {
    // A tall, narrow region can only be covered by bricks laid on end.
    const g = solid(2, 16);
    const tiling = tileFlat(g, { inventory, seed: 3, restarts: 30 });
    expect(check(tiling, g, inventory)).toEqual([]);
    expect(tiling.placements.every((p) => p.w === 2 && p.h === 8)).toBe(true);
  });

  it('improves with more restarts, or at least never gets worse', () => {
    const g = corpus[12]!.grid;
    const few = tileFlat(g, { inventory, seed: 5, restarts: 1 });
    const many = tileFlat(g, { inventory, seed: 5, restarts: 120 });
    expect(many.stats.score).toBeLessThanOrEqual(few.stats.score);
  });

  it('honours the time budget instead of running every restart', () => {
    const g = solid(64, 64);
    const tiling = tileFlat(g, { inventory, seed: 1, restarts: 100000, budgetMs: 120 });
    expect(tiling.stats.trials).toBeLessThan(100000);
    expect(tiling.stats.trials).toBeGreaterThan(0);
    expect(tiling.stats.elapsedMs).toBeLessThan(3000);
  });

  it('reports progress', () => {
    const seen: number[] = [];
    tileFlat(solid(8, 8), {
      inventory,
      restarts: 5,
      onProgress: (f) => seen.push(f),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBeCloseTo(1, 5);
  });

  it('weights can be pushed to avoid 1x1s', () => {
    const g = corpus[8]!.grid;
    const neutral = tileFlat(g, {
      inventory,
      seed: 11,
      restarts: 60,
      weights: { pieces: 1, ones: 0, seam: 0 },
    });
    const avoidOnes = tileFlat(g, {
      inventory,
      seed: 11,
      restarts: 60,
      weights: { pieces: 1, ones: 5, seam: 0 },
    });
    expect(avoidOnes.stats.ones).toBeLessThanOrEqual(neutral.stats.ones);
  });

  /**
   * The search can stop being wanted while it runs — the user moved a slider
   * again. Without a way out, an obsolete tile still burns its whole budget
   * before the one they are waiting for can start.
   */
  describe('shouldAbort', () => {
    const g = grid(48, 48, (c, r) => (c * r) % 4);

    it('stops the restart search early', () => {
      const full = tileFlat(g, { inventory, seed: 1, restarts: 200 });
      let calls = 0;
      const aborted = tileFlat(g, {
        inventory,
        seed: 1,
        restarts: 200,
        shouldAbort: () => ++calls >= 3,
      });
      expect(calls).toBe(3);
      expect(aborted.stats.trials).toBe(3);
      expect(full.stats.trials).toBeGreaterThan(aborted.stats.trials);
    });

    it('still returns a valid, complete tiling', () => {
      // Abandoning is not failing: whatever it hands back has to be buildable,
      // because the caller may yet decide to keep it.
      const aborted = tileFlat(g, {
        inventory,
        seed: 7,
        restarts: 200,
        shouldAbort: () => true,
      });
      expect(aborted.placements.length).toBeGreaterThan(0);
      expect(validateTiling(aborted, { grid: g, inventory })).toEqual([]);
    });

    it('is never consulted before a first result exists', () => {
      // Aborting on the very first call must still leave one completed trial,
      // or there would be nothing to return.
      const aborted = tileFlat(g, {
        inventory,
        seed: 2,
        restarts: 200,
        shouldAbort: () => true,
      });
      expect(aborted.stats.trials).toBe(1);
    });

    it('changes nothing when it never fires', () => {
      const plain = tileFlat(g, { inventory, seed: 5, restarts: 40 });
      const watched = tileFlat(g, {
        inventory,
        seed: 5,
        restarts: 40,
        shouldAbort: () => false,
      });
      expect(watched.stats.pieces).toBe(plain.stats.pieces);
      expect(watched.stats.trials).toBe(plain.stats.trials);
    });
  });
});

// ---------------------------------------------------------------------------

describe('pips-up tiler', () => {
  const inventory = DEFAULT_WALL_INVENTORY;

  it('never places a brick spanning two courses', () => {
    for (const { grid: g } of corpus) {
      const tiling = tileWall(g, { inventory });
      expect(tiling.placements.every((p) => p.h === 1)).toBe(true);
    }
  });

  /**
   * Coin change, solved exactly. With lengths 1,2,3,4,6,8 a run of 5 is 3+2
   * and a run of 7 is 4+3 — both two pieces. A greedy longest-first would take
   * 4+1 and 6+1, adding a 1x1 each time.
   */
  it('splits awkward run lengths optimally', () => {
    const cases: Array<[number, number]> = [
      [1, 1],
      [5, 2],
      [7, 2],
      [9, 2],
      [11, 2],
      [13, 3],
      [17, 3],
    ];
    for (const [runLength, expectedPieces] of cases) {
      const g = solid(runLength, 1);
      const tiling = tileWall(g, { inventory });
      expect(tiling.stats.pieces).toBe(expectedPieces);
    }
  });

  it('prefers two mid-size bricks over a long one plus a 1x1', () => {
    const tiling = tileWall(solid(5, 1), { inventory });
    const lengths = tiling.placements.map((p) => p.w).sort((a, b) => a - b);
    expect(lengths).toEqual([2, 3]);
  });

  /**
   * The structural payoff. A solid rectangle could trivially be tiled with
   * every course identical, which stacks every seam into a continuous vertical
   * crack. The stagger penalty inside the DP must break that up.
   */
  it('produces running bond on a solid wall — zero aligned seams', () => {
    const tiling = tileWall(solid(32, 20), { inventory });
    expect(tiling.stats.alignedSeams).toBe(0);
  });

  /**
   * Staggering is not free, and the price is worth knowing. A 32-wide run has
   * exactly one minimum-piece tiling (8+8+8+8), so breaking the bond costs an
   * extra brick on the courses that break it. That buys a wall that does not
   * have a continuous vertical crack through it.
   */
  it('buys zero aligned seams for a small, bounded number of extra pieces', () => {
    const g = solid(32, 20);
    const staggered = tileWall(g, { inventory });
    const ignoringSeams = tileWall(g, {
      inventory,
      weights: { pieces: 1, ones: 0.5, seam: 0 },
    });

    expect(ignoringSeams.stats.alignedSeams).toBeGreaterThan(0);
    expect(staggered.stats.alignedSeams).toBe(0);

    expect(staggered.stats.pieces).toBeGreaterThan(ignoringSeams.stats.pieces);
    expect(staggered.stats.pieces).toBeLessThan(ignoringSeams.stats.pieces * 1.2);
    // And it still uses no 1x1s to achieve it.
    expect(staggered.stats.ones).toBe(0);
  });

  it('looks back more than one course, so seams do not alternate', () => {
    const g = solid(32, 12);
    const deep = tileWall(g, { inventory, staggerLookback: [1, 0.4] });
    const shallow = tileWall(g, { inventory, staggerLookback: [1] });
    // Both avoid immediate repeats; only the deeper lookback also avoids
    // a seam returning to the same column every other course.
    const seamColumnsByRow = (t: Tiling) => {
      const rowsMap = new Map<number, Set<number>>();
      for (const p of t.placements) {
        if (p.col === 0) continue;
        const set = rowsMap.get(p.row) ?? new Set<number>();
        set.add(p.col);
        rowsMap.set(p.row, set);
      }
      return rowsMap;
    };
    const countTwoApart = (t: Tiling) => {
      const byRow = seamColumnsByRow(t);
      let repeats = 0;
      for (const [row, cols] of byRow) {
        const two = byRow.get(row + 2);
        if (!two) continue;
        for (const c of cols) if (two.has(c)) repeats++;
      }
      return repeats;
    };
    expect(countTwoApart(deep)).toBeLessThanOrEqual(countTwoApart(shallow));
  });

  it('treats a color change as a seam the next course should avoid', () => {
    // Two colors meeting at a fixed column: the courses above should not all
    // put their own seams there as well.
    const g = grid(24, 10, (c) => (c < 12 ? 0 : 1));
    const tiling = tileWall(g, { inventory });
    expect(check(tiling, g, DEFAULT_WALL_INVENTORY)).toEqual([]);
    // The forced boundary at column 12 exists in every course, but it is the
    // only place four bricks are permitted to meet.
    expect(tiling.stats.alignedSeams).toBeLessThanOrEqual(g.rows);
  });

  it('reports progress', () => {
    const seen: number[] = [];
    tileWall(solid(8, 8), { inventory, onProgress: (f) => seen.push(f) });
    expect(seen.at(-1)).toBeCloseTo(1, 5);
  });

  it('falls back to shorter bricks when a color lacks the long ones', () => {
    const limited = colors.findIndex((c) => !c.shapes.includes('3008'));
    expect(limited).toBeGreaterThanOrEqual(0);
    const g = solid(16, 4, limited);
    const tiling = tileWall(g, { inventory, strict: true, colors });
    expect(check(tiling, g, DEFAULT_WALL_INVENTORY, true)).toEqual([]);
    for (const p of tiling.placements) {
      expect(colors[limited]!.shapes).toContain(p.designId);
    }
  });
});

// ---------------------------------------------------------------------------

describe('validateTiling', () => {
  const g = solid(4, 4);
  const good = tile(g, 'pips-out', { inventory: DEFAULT_FLAT_INVENTORY, restarts: 4 });

  it('accepts a sound tiling', () => {
    expect(check(good, g, DEFAULT_FLAT_INVENTORY)).toEqual([]);
  });

  it('catches gaps', () => {
    const holed: Tiling = { ...good, placements: good.placements.slice(0, -1) };
    expect(check(holed, g, DEFAULT_FLAT_INVENTORY).join()).toMatch(/not covered/);
  });

  it('catches overlaps', () => {
    const doubled: Tiling = {
      ...good,
      placements: [...good.placements, good.placements[0]!],
    };
    expect(check(doubled, g, DEFAULT_FLAT_INVENTORY).join()).toMatch(/overlaps/);
  });

  it('catches a placement running off the grid', () => {
    const off: Tiling = {
      ...good,
      placements: [{ designId: '3005', col: 9, row: 9, w: 1, h: 1, colorIdx: 0 }],
    };
    expect(check(off, g, DEFAULT_FLAT_INVENTORY).join()).toMatch(/outside the grid/);
  });

  it('catches a non-monochrome placement', () => {
    const twoColor = grid(2, 1, (c) => c);
    const bad: Tiling = {
      orientation: 'pips-out',
      cols: 2,
      rows: 1,
      placements: [{ designId: '3004', col: 0, row: 0, w: 2, h: 1, colorIdx: 0 }],
      stats: good.stats,
    };
    expect(check(bad, twoColor, DEFAULT_FLAT_INVENTORY).join()).toMatch(/claims color/);
  });

  it('catches a shape outside the inventory', () => {
    expect(check(good, g, ['3005']).join()).toMatch(/outside the inventory/);
  });

  it('catches dimensions the shape cannot take', () => {
    const bad: Tiling = {
      ...good,
      placements: [{ designId: '3005', col: 0, row: 0, w: 4, h: 4, colorIdx: 0 }],
    };
    expect(check(bad, g, DEFAULT_FLAT_INVENTORY).join()).toMatch(/cannot be/);
  });

  it('catches a multi-course brick in a wall', () => {
    const bad: Tiling = {
      orientation: 'pips-up',
      cols: 4,
      rows: 4,
      placements: [{ designId: '3003', col: 0, row: 0, w: 2, h: 2, colorIdx: 0 }],
      stats: good.stats,
    };
    expect(check(bad, g, [...DEFAULT_FLAT_INVENTORY]).join()).toMatch(/one course tall/);
  });

  it('catches a mismatch between tiling and grid dimensions', () => {
    expect(check(good, solid(8, 8), DEFAULT_FLAT_INVENTORY).join()).toMatch(
      /but the grid is/
    );
  });

  it('requires a palette when strict is on', () => {
    expect(
      validateTiling(good, { grid: g, inventory: DEFAULT_FLAT_INVENTORY, strict: true })
    ).toEqual(['Strict availability requested but no palette supplied']);
  });
});
