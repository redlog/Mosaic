import { describe, expect, it } from 'vitest';
import {
  colorsMissingBricklinkId,
  enabledColors,
  legalShapes,
  loadPalette,
  unusableColors,
  validatePaletteFile,
} from './palette';
import { hasShape } from './parts';
import { isValidHex } from './color';
import type { PaletteFile } from './types';
import paletteData from './palette.data.json';

const validFile = (): PaletteFile => ({
  id: 'test',
  provenance: { source: 'test', generated: '2026-01-01', verified: true, note: '' },
  colors: [
    { key: 'red', name: 'Red', hex: '#C91A09', blColorId: 5, shapes: ['3005', '3004'] },
    { key: 'blue', name: 'Blue', hex: '#0055BF', blColorId: 7, shapes: ['3005'] },
  ],
});

describe('built-in palette', () => {
  const palette = loadPalette();

  /**
   * Structural checks only. The hex values and BrickLink IDs in
   * palette.data.json are hand-maintained and explicitly unverified, so
   * asserting specific values here would freeze today's guesses into the
   * suite and make correcting the data look like a regression.
   */
  it('is structurally valid', () => {
    expect(validatePaletteFile(paletteData).errors).toEqual([]);
    for (const c of palette.colors) {
      expect(c.key).toMatch(/^[a-z0-9-]+$/);
      expect(c.name.length).toBeGreaterThan(0);
      expect(isValidHex(c.hex)).toBe(true);
      expect(c.blColorId === null || Number.isInteger(c.blColorId)).toBe(true);
      expect(c.shapes.length).toBeGreaterThan(0);
      for (const id of c.shapes) expect(hasShape(id)).toBe(true);
    }
  });

  it('has unique keys and indexes them', () => {
    const keys = palette.colors.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of palette.colors) expect(palette.byKey.get(c.key)).toBe(c);
  });

  it('offers a usable spread of colors', () => {
    expect(palette.colors.length).toBeGreaterThanOrEqual(30);
    expect(palette.byKey.has('white')).toBe(true);
    expect(palette.byKey.has('black')).toBe(true);
  });

  it('precomputes plausible Lab values', () => {
    const white = palette.byKey.get('white')!;
    const black = palette.byKey.get('black')!;
    expect(white.lab[0]).toBeCloseTo(100, 1);
    expect(black.lab[0]).toBeLessThan(15);
    expect(white.lab[0]).toBeGreaterThan(black.lab[0]);
  });

  it('warns that its data is unverified', () => {
    expect(palette.provenance.verified).toBe(false);
    expect(palette.warnings.join(' ')).toMatch(/unverified/i);
  });

  it('is usable by the default wall inventory', () => {
    // Every color must be buildable as at least a 1x1, or strict availability
    // would silently drop it.
    for (const c of palette.colors) expect(c.shapes).toContain('3005');
  });
});

describe('validatePaletteFile', () => {
  it('accepts a well-formed file', () => {
    expect(validatePaletteFile(validFile()).errors).toEqual([]);
  });

  it('rejects non-objects and missing collections', () => {
    expect(validatePaletteFile(null).errors.length).toBeGreaterThan(0);
    expect(validatePaletteFile('nope').errors.length).toBeGreaterThan(0);
    expect(validatePaletteFile({ id: 'x' }).errors).toContain(
      'Palette file needs a `colors` array'
    );
    expect(validatePaletteFile({ id: 'x', colors: [] }).errors).toContain(
      'Palette contains no colors'
    );
  });

  it('catches duplicate keys', () => {
    const file = validFile();
    file.colors[1]!.key = 'red';
    expect(validatePaletteFile(file).errors.join()).toMatch(/duplicates key "red"/);
  });

  it('catches malformed hex', () => {
    const file = validFile();
    file.colors[0]!.hex = 'not-a-color';
    expect(validatePaletteFile(file).errors.join()).toMatch(/invalid `hex`/);
  });

  it('catches unknown design IDs', () => {
    const file = validFile();
    file.colors[0]!.shapes = ['3005', '9999'];
    expect(validatePaletteFile(file).errors.join()).toMatch(/unknown design ID/);
  });

  it('catches empty shape lists', () => {
    const file = validFile();
    file.colors[0]!.shapes = [];
    expect(validatePaletteFile(file).errors.join()).toMatch(/non-empty `shapes`/);
  });

  it('catches a non-integer BrickLink ID but allows an explicit null', () => {
    const bad = validFile();
    (bad.colors[0] as { blColorId: unknown }).blColorId = 'five';
    expect(validatePaletteFile(bad).errors.join()).toMatch(/must be an integer or null/);

    const nulled = validFile();
    nulled.colors[0]!.blColorId = null;
    const result = validatePaletteFile(nulled);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join()).toMatch(/omitted from XML export/);
  });
});

describe('loadPalette', () => {
  it('throws on structurally invalid data rather than limping along', () => {
    const file = validFile();
    file.colors[0]!.hex = 'zzz';
    expect(() => loadPalette({ data: file })).toThrow(/Invalid palette data/);
  });

  it('applies hex overrides and recomputes color spaces', () => {
    const base = loadPalette({ data: validFile() });
    const overridden = loadPalette({
      data: validFile(),
      overrides: [{ key: 'red', hex: '#FF0000' }],
    });
    const red = overridden.byKey.get('red')!;
    expect(red.hex).toBe('#FF0000');
    expect(red.rgb).toEqual([255, 0, 0]);
    expect(red.lab[0]).not.toBeCloseTo(base.byKey.get('red')!.lab[0], 3);
    // Untouched colors are unaffected.
    expect(overridden.byKey.get('blue')!.hex).toBe('#0055BF');
  });

  it('rejects an override with a malformed hex', () => {
    expect(() =>
      loadPalette({ data: validFile(), overrides: [{ key: 'red', hex: 'nope' }] })
    ).toThrow(/invalid hex/i);
  });

  it('ignores overrides for keys that do not exist', () => {
    const palette = loadPalette({
      data: validFile(),
      overrides: [{ key: 'chartreuse', hex: '#7FFF00' }],
    });
    expect(palette.colors).toHaveLength(2);
  });
});

describe('availability', () => {
  const palette = loadPalette({ data: validFile() });
  const red = palette.byKey.get('red')!;
  const blue = palette.byKey.get('blue')!;

  it('intersects with real availability under strict mode', () => {
    expect(legalShapes(red, ['3005', '3004', '3001'], true)).toEqual(['3005', '3004']);
    expect(legalShapes(blue, ['3005', '3004', '3001'], true)).toEqual(['3005']);
  });

  it('passes the whole inventory through when strict is off', () => {
    expect(legalShapes(blue, ['3005', '3004', '3001'], false)).toEqual([
      '3005',
      '3004',
      '3001',
    ]);
  });

  it('preserves inventory order, not the color list order', () => {
    expect(legalShapes(red, ['3004', '3005'], true)).toEqual(['3004', '3005']);
  });

  it('flags colors with nothing legal in the chosen inventory', () => {
    expect(unusableColors([red, blue], ['3001', '3007'])).toEqual([red, blue]);
    expect(unusableColors([red, blue], ['3005'])).toEqual([]);
    expect(unusableColors([red, blue], ['3004'])).toEqual([blue]);
  });
});

describe('enabledColors', () => {
  const palette = loadPalette({ data: validFile() });

  it('returns everything when no selection is given', () => {
    expect(enabledColors(palette)).toHaveLength(2);
  });

  it('filters to the selection, preserving palette order', () => {
    expect(enabledColors(palette, ['blue']).map((c) => c.key)).toEqual(['blue']);
    expect(enabledColors(palette, ['blue', 'red']).map((c) => c.key)).toEqual([
      'red',
      'blue',
    ]);
  });

  it('ignores unknown keys', () => {
    expect(enabledColors(palette, ['nonesuch'])).toEqual([]);
  });
});

describe('colorsMissingBricklinkId', () => {
  it('finds exactly the colors that cannot be exported to BrickLink', () => {
    const file = validFile();
    file.colors[1]!.blColorId = null;
    const palette = loadPalette({ data: file });
    expect(colorsMissingBricklinkId(palette.colors).map((c) => c.key)).toEqual(['blue']);
  });
});
