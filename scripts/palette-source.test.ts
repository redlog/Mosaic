import { describe, expect, it } from 'vitest';
import {
  TIERS,
  normalizeHex,
  parseCsv,
  parseInput,
  slugify,
  toPaletteFile,
} from './palette-source';
import { validatePaletteFile } from '../src/lego/palette';

describe('parseCsv', () => {
  it('reads a simple table', () => {
    expect(parseCsv('name,hex\nRed,#C91A09\nBlue,#0055BF\n')).toEqual([
      { name: 'Red', hex: '#C91A09' },
      { name: 'Blue', hex: '#0055BF' },
    ]);
  });

  it('normalizes header casing and spacing', () => {
    expect(parseCsv('Color Name,BL-ID\nRed,5\n')).toEqual([
      { color_name: 'Red', bl_id: '5' },
    ]);
  });

  it('handles quoted fields, doubled quotes, and embedded commas', () => {
    const rows = parseCsv('name,note\n"Dark, Red","a ""quoted"" note"\n');
    expect(rows[0]).toEqual({ name: 'Dark, Red', note: 'a "quoted" note' });
  });

  it('handles CRLF, a trailing newline, and blank lines', () => {
    expect(parseCsv('name,hex\r\nRed,#C91A09\r\n\r\n')).toHaveLength(1);
    expect(parseCsv('name,hex\nRed,#C91A09')).toHaveLength(1);
  });

  it('strips a UTF-8 BOM, which spreadsheet exports leave on the first header', () => {
    expect(parseCsv('\uFEFFname,hex\nRed,#C91A09\n')[0]).toEqual({
      name: 'Red',
      hex: '#C91A09',
    });
  });

  it('pads short rows rather than misaligning fields', () => {
    expect(parseCsv('name,hex,bl_id\nRed,#C91A09\n')[0]).toEqual({
      name: 'Red',
      hex: '#C91A09',
      bl_id: '',
    });
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('normalizeHex', () => {
  it('accepts hex with or without a hash, and uppercases', () => {
    expect(normalizeHex('#c91a09')).toBe('#C91A09');
    expect(normalizeHex('c91a09')).toBe('#C91A09');
  });

  it('accepts comma- and space-separated RGB triples', () => {
    expect(normalizeHex('201,26,9')).toBe('#C91A09');
    expect(normalizeHex('201 26 9')).toBe('#C91A09');
  });

  it('rejects anything else', () => {
    expect(() => normalizeHex('rebeccapurple')).toThrow(/Cannot parse/);
    expect(() => normalizeHex('300,0,0')).toThrow(/Cannot parse/);
    expect(() => normalizeHex('')).toThrow(/Cannot parse/);
  });
});

describe('slugify', () => {
  it('produces stable keys from display names', () => {
    expect(slugify('Dark Bluish Gray')).toBe('dark-bluish-gray');
    expect(slugify('Trans-Clear')).toBe('trans-clear');
    expect(slugify('  Bright  Light Orange ')).toBe('bright-light-orange');
  });
});

describe('toPaletteFile', () => {
  const rows = [
    { name: 'Red', hex: '#C91A09', bl_id: '5', tier: 'full' },
    { name: 'Dark Turquoise', hex: '#008F9B', bl_id: '39' },
  ];

  it('builds a file that passes the runtime validator', () => {
    const file = toPaletteFile(rows, { generated: '2026-01-01' });
    expect(validatePaletteFile(file).errors).toEqual([]);
  });

  it('derives keys and expands tiers', () => {
    const file = toPaletteFile(rows, { generated: '2026-01-01' });
    expect(file.colors[0]).toMatchObject({
      key: 'red',
      name: 'Red',
      hex: '#C91A09',
      blColorId: 5,
      shapes: TIERS.full,
    });
    // No tier column, so the default applies.
    expect(file.colors[1]!.key).toBe('dark-turquoise');
    expect(file.colors[1]!.shapes).toEqual(TIERS.common);
  });

  it('honours an explicit shapes column over the tier', () => {
    const file = toPaletteFile([{ name: 'Red', hex: '#C91A09', shapes: '3005 3004' }]);
    expect(file.colors[0]!.shapes).toEqual(['3005', '3004']);
  });

  it('treats a missing BrickLink ID as null rather than guessing', () => {
    const file = toPaletteFile([{ name: 'Red', hex: '#C91A09' }]);
    expect(file.colors[0]!.blColorId).toBeNull();
    expect(validatePaletteFile(file).warnings.join()).toMatch(
      /no known BrickLink color ID/
    );
  });

  it('marks output unverified unless told otherwise', () => {
    expect(toPaletteFile(rows).provenance.verified).toBe(false);
    expect(toPaletteFile(rows, { verified: true }).provenance.verified).toBe(true);
    expect(toPaletteFile(rows).provenance.note).toMatch(/UNVERIFIED/);
  });

  it('rejects rows missing required fields', () => {
    expect(() => toPaletteFile([{ hex: '#C91A09' }])).toThrow(/no `name`/);
    expect(() => toPaletteFile([{ name: 'Red' }])).toThrow(/no `hex`/);
    expect(() => toPaletteFile([{ name: 'Red', hex: '#C91A09', bl_id: 'five' }])).toThrow(
      /non-integer BrickLink ID/
    );
  });

  it('rejects an unknown tier instead of silently defaulting', () => {
    expect(() => toPaletteFile(rows, { defaultTier: 'occasional' })).toThrow(
      /Unknown tier/
    );
    expect(() =>
      toPaletteFile([{ name: 'Red', hex: '#C91A09', tier: 'sometimes' }])
    ).toThrow(/unknown tier/);
  });
});

describe('parseInput', () => {
  it('reads CSV', () => {
    const file = parseInput('name,hex,bl_id\nRed,#C91A09,5\n');
    expect(file.colors).toHaveLength(1);
    expect(file.colors[0]!.blColorId).toBe(5);
  });

  it('reads an array of records', () => {
    const file = parseInput('[{"name":"Red","hex":"#C91A09","bl_id":"5"}]');
    expect(file.colors[0]!.key).toBe('red');
  });

  it('passes a complete palette file straight through', () => {
    const original = {
      id: 'mine',
      provenance: { source: 's', generated: '2026-01-01', verified: true, note: '' },
      colors: [
        { key: 'red', name: 'Red', hex: '#C91A09', blColorId: 5, shapes: ['3005'] },
      ],
    };
    expect(parseInput(JSON.stringify(original))).toEqual(original);
  });

  it('rejects JSON that is neither shape', () => {
    expect(() => parseInput('{"nope":true}')).toThrow(/palette file or an array/);
  });
});
