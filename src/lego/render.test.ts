import { describe, expect, it } from 'vitest';
import { DEFAULT_PX_PER_STUD, drawMosaic, renderGeometry, type Ctx2D } from './render';
import { loadPalette } from './palette';
import { tile } from './tile';
import { DEFAULT_FLAT_INVENTORY, DEFAULT_WALL_INVENTORY } from './parts';
import { finishedSize } from './constants';
import type { Grid, Orientation, Tiling } from './types';

const palette = loadPalette();
const colors = [...palette.colors];

const solidGrid = (cols: number, rows: number): Grid => ({
  cols,
  rows,
  colors: new Int16Array(cols * rows),
});

function tiled(cols: number, rows: number, orientation: Orientation): Tiling {
  return tile(solidGrid(cols, rows), orientation, {
    inventory:
      orientation === 'pips-out' ? DEFAULT_FLAT_INVENTORY : DEFAULT_WALL_INVENTORY,
    seed: 1,
    restarts: 8,
  });
}

// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/**
 * A recording 2D context. Lets the drawing logic be exercised in Node without
 * a canvas implementation, and makes structural claims — "clean mode draws no
 * studs", "bricks tile the canvas exactly" — directly assertable.
 */
class RecordingCtx implements Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;

  rects: Rect[] = [];
  arcs: Array<{ x: number; y: number; r: number; start: number; end: number }> = [];
  roundRects: Rect[] = [];
  calls: string[] = [];
  private pendingRoundRect: Omit<Rect, 'fill'> | null = null;

  save(): void {
    this.calls.push('save');
  }
  restore(): void {
    this.calls.push('restore');
  }
  scale(x: number, y: number): void {
    this.calls.push(`scale(${x},${y})`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h, fill: String(this.fillStyle) });
  }
  beginPath(): void {
    this.pendingRoundRect = null;
  }
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  rect(x: number, y: number, w: number, h: number): void {
    this.pendingRoundRect = { x, y, w, h };
  }
  roundRect(x: number, y: number, w: number, h: number): void {
    this.pendingRoundRect = { x, y, w, h };
  }
  arc(x: number, y: number, r: number, start: number, end: number): void {
    this.arcs.push({ x, y, r, start, end });
  }
  fill(): void {
    if (this.pendingRoundRect) {
      this.roundRects.push({ ...this.pendingRoundRect, fill: String(this.fillStyle) });
    }
  }
  stroke(): void {}

  /** Every filled brick body, however it was drawn. */
  get bodies(): Rect[] {
    return [...this.roundRects, ...this.rects];
  }
}

const render = (tiling: Tiling, options = {}): RecordingCtx => {
  const ctx = new RecordingCtx();
  drawMosaic(ctx, tiling, colors, options);
  return ctx;
};

// ---------------------------------------------------------------------------

describe('renderGeometry', () => {
  it('uses square cells laid flat and 5:6 cells in a wall', () => {
    const flat = renderGeometry({ cols: 10, rows: 10, orientation: 'pips-out' });
    expect(flat.cellW).toBe(DEFAULT_PX_PER_STUD);
    expect(flat.cellH).toBe(DEFAULT_PX_PER_STUD);

    const wall = renderGeometry({ cols: 10, rows: 10, orientation: 'pips-up' });
    expect(wall.cellW).toBe(DEFAULT_PX_PER_STUD);
    expect(wall.cellH).toBeCloseTo(DEFAULT_PX_PER_STUD * 1.2, 10);
  });

  /**
   * The preview must be dimensionally honest: its pixel aspect has to match
   * the finished build's physical aspect, or a wall looks square on screen and
   * arrives 20% taller than expected.
   */
  it('matches the finished physical aspect in both orientations', () => {
    for (const orientation of ['pips-out', 'pips-up'] as const) {
      for (const [cols, rows] of [
        [48, 48],
        [64, 32],
        [30, 50],
      ]) {
        const geometry = renderGeometry({ cols: cols!, rows: rows!, orientation });
        const built = finishedSize(cols!, rows!, orientation);
        expect(geometry.contentWidth / geometry.contentHeight).toBeCloseTo(
          built.widthMm / built.heightMm,
          2
        );
      }
    }
  });

  it('scales the bitmap without changing the layout', () => {
    const base = renderGeometry({ cols: 16, rows: 16, orientation: 'pips-out' });
    const doubled = renderGeometry(
      { cols: 16, rows: 16, orientation: 'pips-out' },
      { scale: 2 }
    );
    expect(doubled.width).toBe(base.width * 2);
    expect(doubled.contentWidth).toBe(base.contentWidth);
  });

  it('adds padding on every side', () => {
    const geometry = renderGeometry(
      { cols: 10, rows: 10, orientation: 'pips-out' },
      { pxPerStud: 10, padding: 5 }
    );
    expect(geometry.contentWidth).toBe(100);
    expect(geometry.width).toBe(110);
  });

  it('reports whole-pixel bitmap dimensions even at a fractional cell height', () => {
    const geometry = renderGeometry(
      { cols: 7, rows: 7, orientation: 'pips-up' },
      { pxPerStud: 23, scale: 3, padding: 4 }
    );
    expect(Number.isInteger(geometry.width)).toBe(true);
    expect(Number.isInteger(geometry.height)).toBe(true);
  });
});

describe('drawing', () => {
  it('draws one body per brick', () => {
    const tiling = tiled(16, 16, 'pips-out');
    expect(render(tiling).bodies).toHaveLength(tiling.placements.length);
  });

  /**
   * Brick rectangles must partition the canvas exactly. Two ways that breaks:
   * rounding cell *sizes* rather than shared edges drifts a pixel every few
   * courses (a wall cell is 28.8px tall at the default zoom), and filling a
   * rounded path leaves the background showing through as white pinholes
   * wherever four brick corners meet — which on a mosaic is everywhere.
   *
   * The second of those shipped briefly and was caught by looking at a real
   * render, not by this test, because it only ran in clean mode at the time.
   * Hence all four combinations now.
   */
  it.each([
    ['pips-out', 'clean'],
    ['pips-up', 'clean'],
    ['pips-out', 'build'],
    ['pips-up', 'build'],
  ] as const)(
    'tiles the canvas exactly with no gaps or overlaps (%s, %s)',
    (orientation, mode) => {
      const tiling = tiled(24, 24, orientation);
      const geometry = renderGeometry(tiling);
      const ctx = render(tiling, { mode });

      // In build mode a wall also draws 1px mortar lines; brick bodies are the
      // only marks wider and taller than a pixel.
      const bodies = ctx.bodies.filter((r) => r.w > 1 && r.h > 1);

      const covered = new Map<string, number>();
      for (const rect of bodies) {
        expect(Number.isInteger(rect.x)).toBe(true);
        expect(Number.isInteger(rect.y)).toBe(true);
        for (let y = rect.y; y < rect.y + rect.h; y++) {
          for (let x = rect.x; x < rect.x + rect.w; x++) {
            const key = `${x},${y}`;
            covered.set(key, (covered.get(key) ?? 0) + 1);
          }
        }
      }

      expect(covered.size).toBe(geometry.contentWidth * geometry.contentHeight);
      for (const count of covered.values()) expect(count).toBe(1);
    }
  );

  it('offsets everything by the padding', () => {
    const tiling = tiled(4, 4, 'pips-out');
    const ctx = render(tiling, { mode: 'clean', padding: 7, pxPerStud: 10 });
    for (const rect of ctx.bodies) {
      expect(rect.x).toBeGreaterThanOrEqual(7);
      expect(rect.y).toBeGreaterThanOrEqual(7);
      expect(rect.x + rect.w).toBeLessThanOrEqual(47);
    }
  });

  it('paints the background first when one is given', () => {
    const ctx = render(tiled(4, 4, 'pips-out'), {
      mode: 'clean',
      background: '#123456',
      padding: 3,
      pxPerStud: 10,
    });
    expect(ctx.rects[0]).toMatchObject({ x: 0, y: 0, w: 46, h: 46, fill: '#123456' });
  });

  it('applies the scale to the context, not the coordinates', () => {
    const ctx = render(tiled(4, 4, 'pips-out'), { scale: 3, mode: 'clean' });
    expect(ctx.calls).toContain('scale(3,3)');
    const plain = render(tiled(4, 4, 'pips-out'), { mode: 'clean' });
    expect(ctx.bodies[0]).toEqual(plain.bodies[0]);
  });

  it('balances save and restore', () => {
    const ctx = render(tiled(4, 4, 'pips-out'));
    expect(ctx.calls[0]).toBe('save');
    expect(ctx.calls.at(-1)).toBe('restore');
  });

  it('rejects a placement whose color is not in the palette', () => {
    const broken: Tiling = {
      ...tiled(4, 4, 'pips-out'),
      placements: [{ designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 9999 }],
    };
    expect(() => render(broken)).toThrow(/not in the palette/);
  });
});

describe('build vs clean', () => {
  it('draws studs laid flat in build mode', () => {
    const ctx = render(tiled(8, 8, 'pips-out'), { mode: 'build' });
    expect(ctx.arcs.length).toBeGreaterThan(0);
  });

  it('draws one stud per cell, not per brick', () => {
    const tiling = tiled(8, 8, 'pips-out');
    const ctx = render(tiling, { mode: 'build' });
    // Three arcs per stud: the body, the highlight, and the shadow.
    const bodyArcs = ctx.arcs.filter((a) => a.start === 0 && a.end === Math.PI * 2);
    expect(bodyArcs).toHaveLength(64);
  });

  it('draws nothing but flat color in clean mode', () => {
    const ctx = render(tiled(8, 8, 'pips-out'), { mode: 'clean' });
    expect(ctx.arcs).toHaveLength(0);
    expect(ctx.rects).toHaveLength(tiled(8, 8, 'pips-out').placements.length);
  });

  it('never fills a rounded path — only strokes one', () => {
    for (const orientation of ['pips-out', 'pips-up'] as const) {
      for (const mode of ['build', 'clean'] as const) {
        expect(render(tiled(12, 12, orientation), { mode }).roundRects).toHaveLength(0);
      }
    }
  });

  /**
   * A stud-up wall viewed head-on shows no studs — that is the whole reason
   * the orientation exists. Drawing them would be a lie about the finish.
   */
  it('never draws studs in a wall, even in build mode', () => {
    const ctx = render(tiled(12, 12, 'pips-up'), { mode: 'build' });
    expect(ctx.arcs).toHaveLength(0);
  });

  it('draws mortar lines in a wall build view', () => {
    const flat = render(tiled(12, 12, 'pips-up'), { mode: 'clean' });
    const build = render(tiled(12, 12, 'pips-up'), { mode: 'build' });
    // Top highlight and bottom shadow on every brick, plus interior seams.
    expect(build.rects.length).toBeGreaterThan(flat.rects.length * 2);
  });

  it('suppresses studs when they would be smaller than a smudge', () => {
    expect(render(tiled(8, 8, 'pips-out'), { pxPerStud: 4 }).arcs).toHaveLength(0);
    expect(
      render(tiled(8, 8, 'pips-out'), { pxPerStud: 4, showStuds: true }).arcs.length
    ).toBeGreaterThan(0);
  });

  it('honours an explicit showStuds: false', () => {
    expect(render(tiled(8, 8, 'pips-out'), { showStuds: false }).arcs).toHaveLength(0);
  });
});
