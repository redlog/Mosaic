// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CSV_HEADER, csvField, toCsv } from './export-csv';
import { toBricklinkXml, xmlEscape } from './export-bricklink';
import { buildBom, type Bom } from './bom';
import { loadPalette } from './palette';
import { tile } from './tile';
import { DEFAULT_FLAT_INVENTORY } from './parts';
import { parseCsv } from '../../scripts/palette-source';
import type { Grid, LegoColor, Tiling } from './types';

const palette = loadPalette();
const colors = [...palette.colors];

const solidGrid = (cols: number, rows: number): Grid => ({
  cols,
  rows,
  colors: new Int16Array(cols * rows),
});

function tiling(placements: Tiling['placements']): Tiling {
  return {
    orientation: 'pips-out',
    cols: 8,
    rows: 8,
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

/** A realistic BOM from the actual pipeline. */
function realBom(): Bom {
  const g = solidGrid(24, 24);
  return buildBom(
    tile(g, 'pips-out', { inventory: DEFAULT_FLAT_INVENTORY, seed: 5, restarts: 20 }),
    colors
  );
}

// ---------------------------------------------------------------------------

describe('csvField', () => {
  it('leaves plain values alone', () => {
    expect(csvField('Red')).toBe('Red');
    expect(csvField(42)).toBe('42');
  });

  it('renders a missing BrickLink ID as an empty field, not "null"', () => {
    expect(csvField(null)).toBe('');
  });

  /**
   * Color and part names come from a hand-editable data file, so a name like
   * "Red, Bright" is entirely possible — and unquoted it would split into two
   * columns and shift every field after it.
   */
  it('quotes values containing commas, quotes, or newlines', () => {
    expect(csvField('Red, Bright')).toBe('"Red, Bright"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });
});

describe('toCsv', () => {
  it('starts with the documented header', () => {
    expect(toCsv(realBom()).split('\n')[0]).toBe(CSV_HEADER.join(','));
  });

  it('ends with a trailing newline', () => {
    expect(toCsv(realBom()).endsWith('\n')).toBe(true);
  });

  it('round-trips: every row parses back to what went in', () => {
    const bom = realBom();
    const rows = parseCsv(toCsv(bom));
    expect(rows).toHaveLength(bom.lines.length);
    for (const [i, line] of bom.lines.entries()) {
      expect(rows[i]).toEqual({
        color_name: line.colorName,
        bl_color_id: line.blColorId === null ? '' : String(line.blColorId),
        part_name: line.partName,
        design_id: line.designId,
        quantity: String(line.quantity),
      });
    }
  });

  it('survives a color name containing a comma', () => {
    const awkward: LegoColor[] = [{ ...colors[0]!, name: 'Red, Bright' }];
    const bom = buildBom(
      tiling([{ designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 0 }]),
      awkward
    );
    const rows = parseCsv(toCsv(bom));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.color_name).toBe('Red, Bright');
    expect(rows[0]!.quantity).toBe('1');
  });

  it('produces a header-only file for an empty BOM', () => {
    const empty = buildBom(tiling([]), colors);
    expect(toCsv(empty)).toBe(`${CSV_HEADER.join(',')}\n`);
    expect(parseCsv(toCsv(empty))).toEqual([]);
  });

  it('quantities in the file sum to the piece count', () => {
    const bom = realBom();
    const total = parseCsv(toCsv(bom)).reduce((sum, r) => sum + Number(r.quantity), 0);
    expect(total).toBe(bom.totals.pieces);
  });
});

// ---------------------------------------------------------------------------

describe('xmlEscape', () => {
  it('escapes the five XML entities', () => {
    expect(xmlEscape(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
  });
});

describe('toBricklinkXml', () => {
  const parse = (xml: string): Document =>
    new DOMParser().parseFromString(xml, 'application/xml');

  it('produces well-formed XML', () => {
    const doc = parse(toBricklinkXml(realBom()).xml);
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.nodeName).toBe('INVENTORY');
  });

  it('emits one ITEM per line with the documented fields', () => {
    const bom = realBom();
    const doc = parse(toBricklinkXml(bom).xml);
    const items = [...doc.querySelectorAll('ITEM')];
    expect(items).toHaveLength(bom.lines.length);

    for (const [i, item] of items.entries()) {
      const line = bom.lines[i]!;
      expect(item.querySelector('ITEMTYPE')?.textContent).toBe('P');
      expect(item.querySelector('ITEMID')?.textContent).toBe(line.designId);
      expect(item.querySelector('COLOR')?.textContent).toBe(String(line.blColorId));
      expect(item.querySelector('MINQTY')?.textContent).toBe(String(line.quantity));
    }
  });

  it('quantities in the file sum to the piece count', () => {
    const bom = realBom();
    const doc = parse(toBricklinkXml(bom).xml);
    const total = [...doc.querySelectorAll('MINQTY')].reduce(
      (sum, node) => sum + Number(node.textContent),
      0
    );
    expect(total).toBe(bom.totals.pieces);
  });

  /**
   * The failure this guards against is the worst one in the app: a wrong COLOR
   * id does not error, it silently orders the wrong color. Omitting and saying
   * so beats guessing.
   */
  it('omits colors with no BrickLink ID rather than guessing one', () => {
    const noId: LegoColor[] = [
      { ...colors[0]!, blColorId: null },
      { ...colors[1]!, blColorId: 7 },
    ];
    const bom = buildBom(
      tiling([
        { designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 0 },
        { designId: '3005', col: 1, row: 0, w: 1, h: 1, colorIdx: 0 },
        { designId: '3004', col: 2, row: 0, w: 2, h: 1, colorIdx: 1 },
      ]),
      noId
    );
    const result = toBricklinkXml(bom);

    expect(result.included).toHaveLength(1);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]!.quantity).toBe(2);

    const doc = parse(result.xml);
    expect(doc.querySelectorAll('ITEM')).toHaveLength(1);
    expect(doc.querySelector('COLOR')?.textContent).toBe('7');
    // Nothing that could be mistaken for a real id leaked through.
    expect(result.xml).not.toMatch(/<COLOR>(null|undefined|NaN|-1)<\/COLOR>/);

    expect(result.warnings.join()).toMatch(/Omitted 1 line \(2 bricks\)/);
  });

  it('warns when nothing at all can be exported', () => {
    const noId: LegoColor[] = [{ ...colors[0]!, blColorId: null }];
    const bom = buildBom(
      tiling([{ designId: '3005', col: 0, row: 0, w: 1, h: 1, colorIdx: 0 }]),
      noId
    );
    const result = toBricklinkXml(bom);
    expect(result.warnings.join()).toMatch(/Nothing to export/);
    expect(parse(result.xml).querySelectorAll('ITEM')).toHaveLength(0);
  });

  it('stays well-formed with no items', () => {
    const result = toBricklinkXml(buildBom(tiling([]), colors));
    const doc = parse(result.xml);
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.nodeName).toBe('INVENTORY');
  });

  it('is silent when every line exports cleanly', () => {
    expect(toBricklinkXml(realBom()).warnings).toEqual([]);
  });
});
