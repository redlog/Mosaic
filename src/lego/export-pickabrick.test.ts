import { describe, expect, it } from 'vitest';
import {
  PICKABRICK_HEADER,
  PICKABRICK_MAX_PER_LINE,
  toPickABrickCsv,
} from './export-pickabrick';
import { buildBom } from './bom';
import { loadPalette } from './palette';
import { parseCsv } from '../../scripts/palette-source';
import type { LegoColor, Tiling } from './types';

const palette = loadPalette();
const red = palette.byKey.get('red')!;
const blue = palette.byKey.get('blue')!;

/** Colors carrying the element IDs from the user's own example rows. */
const withElements: LegoColor[] = [
  { ...red, elements: { '3003': '300321', '3001': '300121' } },
  { ...blue, elements: { '3001': '300123' } },
];

function tiling(placements: Tiling['placements']): Tiling {
  return {
    orientation: 'pips-out',
    cols: 32,
    rows: 32,
    placements,
    stats: {
      pieces: placements.length,
      ones: 0,
      alignedSeams: 0,
      score: 0,
      seed: 0,
      trials: 1,
      elapsedMs: 0,
    },
  };
}

const brick = (designId: string, colorIdx: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    designId,
    col: (i * 4) % 24,
    row: Math.floor(i / 6) * 2,
    w: 4,
    h: 2,
    colorIdx,
  }));

describe('format', () => {
  it('emits exactly the two documented columns', () => {
    const bom = buildBom(tiling(brick('3001', 0, 3)), withElements);
    const lines = toPickABrickCsv(bom).csv.trim().split('\n');
    expect(lines[0]).toBe('elementId,quantity');
    expect(PICKABRICK_HEADER).toEqual(['elementId', 'quantity']);
    expect(lines[1]).toBe('300121,3');
  });

  it('ends with a trailing newline', () => {
    const bom = buildBom(tiling(brick('3001', 0, 1)), withElements);
    expect(toPickABrickCsv(bom).csv.endsWith('\n')).toBe(true);
  });

  it('matches the shape lego.com expects', () => {
    const bom = buildBom(
      tiling([...brick('3003', 0, 18), ...brick('3001', 0, 5)]),
      withElements
    );
    const rows = parseCsv(toPickABrickCsv(bom).csv);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['elementid', 'quantity']);
      expect(row.elementid).toMatch(/^\d+$/);
      expect(Number(row.quantity)).toBeGreaterThan(0);
    }
    expect(rows.map((r) => r.elementid).sort()).toEqual(['300121', '300321']);
  });

  /**
   * The whole point of this exporter: Pick a Brick keys on elements, not
   * designs. A design ID leaking through would order the wrong thing, or
   * nothing.
   */
  it('emits element IDs, never design IDs', () => {
    const bom = buildBom(tiling(brick('3001', 0, 4)), withElements);
    const csv = toPickABrickCsv(bom).csv;
    expect(csv).toContain('300121');
    expect(csv).not.toMatch(/^3001,/m);
  });

  it('keeps colors apart even for the same design', () => {
    const bom = buildBom(
      tiling([...brick('3001', 0, 2), ...brick('3001', 1, 7)]),
      withElements
    );
    const rows = parseCsv(toPickABrickCsv(bom).csv);
    expect(rows).toEqual([
      { elementid: '300121', quantity: '2' },
      { elementid: '300123', quantity: '7' },
    ]);
  });
});

describe('quantities', () => {
  it('preserves the total across the whole file', () => {
    const bom = buildBom(
      tiling([...brick('3003', 0, 18), ...brick('3001', 0, 11), ...brick('3001', 1, 4)]),
      withElements
    );
    const total = parseCsv(toPickABrickCsv(bom).csv).reduce(
      (sum, r) => sum + Number(r.quantity),
      0
    );
    expect(total).toBe(bom.totals.pieces);
  });

  /**
   * Pick a Brick caps a single line. Splitting rather than clamping matters:
   * a clamp would quietly drop bricks from an order that looked complete.
   */
  it('splits a quantity above the per-line cap instead of clamping it', () => {
    const count = PICKABRICK_MAX_PER_LINE + 250;
    const bom = buildBom(tiling(brick('3001', 0, count)), withElements);
    const result = toPickABrickCsv(bom);
    const rows = parseCsv(result.csv);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.elementid === '300121')).toBe(true);
    expect(rows.map((r) => Number(r.quantity))).toEqual([PICKABRICK_MAX_PER_LINE, 250]);
    expect(rows.reduce((s, r) => s + Number(r.quantity), 0)).toBe(count);
    expect(result.rows).toBe(2);
  });

  it('leaves a quantity exactly at the cap as one row', () => {
    const bom = buildBom(tiling(brick('3001', 0, PICKABRICK_MAX_PER_LINE)), withElements);
    expect(parseCsv(toPickABrickCsv(bom).csv)).toHaveLength(1);
  });
});

describe('missing element IDs', () => {
  /**
   * The same posture as the BrickLink colour IDs: omit and say so. A guessed
   * element ID orders the wrong part, and Pick a Brick has no name column to
   * catch it by eye.
   */
  it('omits lots with no element ID rather than deriving one', () => {
    // 3007 (2x8) has no element listed for Red above.
    const bom = buildBom(
      tiling([...brick('3001', 0, 3), ...brick('3007', 0, 6)]),
      withElements
    );
    const result = toPickABrickCsv(bom);

    expect(result.included).toHaveLength(1);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]).toMatchObject({ designId: '3007', quantity: 6 });

    const rows = parseCsv(result.csv);
    expect(rows).toEqual([{ elementid: '300121', quantity: '3' }]);
    // Nothing resembling a design ID or a placeholder leaked into the file.
    expect(result.csv).not.toContain('3007');
    expect(result.csv).not.toMatch(/null|undefined|NaN/);
  });

  it('names what it dropped, and how many bricks', () => {
    const bom = buildBom(tiling(brick('3007', 0, 6)), withElements);
    const warning = toPickABrickCsv(bom).warnings.join(' ');
    expect(warning).toMatch(/Omitted 1 lot \(6 bricks\)/);
    expect(warning).toMatch(/2 x 8 in Red/);
  });

  it('explains itself when nothing at all can be exported', () => {
    const bare: LegoColor[] = [{ ...red, elements: {} }];
    const bom = buildBom(tiling(brick('3001', 0, 4)), bare);
    const result = toPickABrickCsv(bom);
    expect(result.included).toHaveLength(0);
    expect(result.warnings.join()).toMatch(/nothing to import/i);
    expect(result.csv.trim()).toBe('elementId,quantity');
  });

  it('is silent when every lot has an element ID', () => {
    const bom = buildBom(tiling(brick('3001', 0, 2)), withElements);
    expect(toPickABrickCsv(bom).warnings).toEqual([]);
  });

  it('treats a color with no elements block at all as unknown, not an error', () => {
    const bom = buildBom(tiling(brick('3001', 0, 2)), [red]);
    const result = toPickABrickCsv(bom);
    expect(result.omitted).toHaveLength(1);
    expect(result.csv.trim()).toBe('elementId,quantity');
  });
});

describe('empty build', () => {
  it('produces a header-only file', () => {
    const bom = buildBom(tiling([]), withElements);
    expect(toPickABrickCsv(bom).csv).toBe('elementId,quantity\n');
  });
});
