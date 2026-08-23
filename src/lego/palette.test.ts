import { describe, expect, it } from 'vitest';
import {
  colorsMissingBricklinkId,
  defaultColorKeys,
  elementIdFor,
  enabledColors,
  isCurrent,
  legalShapes,
  loadPalette,
  unusableColors,
  validatePaletteFile,
} from './palette';
import { BRICK_SHAPES } from './parts';
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
   * Structural checks only. Every value in palette.data.json is generated
   * from data/rebrickable/ by `npm run palette:build`, so asserting specific
   * hex values or element IDs here would just restate the input and make a
   * catalog refresh look like a regression.
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

  it('is built from a real catalog but keeps BrickLink IDs unverified', () => {
    expect(palette.provenance.verified).toBe(true);
    expect(palette.provenance.bricklinkVerified).toBe(false);
    expect(palette.warnings.join(' ')).toMatch(/BrickLink color IDs .*unverified/i);
  });

  it('carries an element ID for every pair it claims to be available in', () => {
    // The whole point of the Rebrickable build: availability is derived from
    // the elements that exist, so the two can never disagree.
    for (const c of palette.colors) {
      for (const designId of c.shapes) {
        expect(elementIdFor(c, designId)).toMatch(/^\d+$/);
      }
      expect(Object.keys(c.elements ?? {}).sort()).toEqual([...c.shapes].sort());
    }
  });

  it('records a finish and a production span for every color', () => {
    for (const c of palette.colors) {
      expect(c.finish).toBeDefined();
      expect(c.years?.length).toBe(2);
      expect(c.trans).toBe(c.finish === 'transparent' || /^Glitter Trans/.test(c.name));
    }
  });

  it('defaults to the solid colors still in production', () => {
    const defaults = defaultColorKeys([...palette.colors]);
    expect(defaults.length).toBeGreaterThanOrEqual(30);
    expect(defaults.length).toBeLessThan(palette.colors.length);
    for (const key of defaults) {
      const c = palette.byKey.get(key)!;
      expect(c.finish).toBe('solid');
      expect(isCurrent(c)).toBe(true);
    }
    expect(defaults).toContain('white');
    expect(defaults).toContain('black');
    expect(defaults).not.toContain('trans-clear');
  });

  it('auto-disables colors with no 1x1 rather than letting them break a tiling', () => {
    // Real availability data has colors that exist only in larger bricks —
    // Flat Silver has no 1x1 — and a single such cell would be uncoverable.
    const inventory = BRICK_SHAPES.map((s) => s.designId);
    const noOnes = palette.colors.filter((c) => !c.shapes.includes('3005'));
    expect(noOnes.length).toBeGreaterThan(0);
    const unusable = new Set(
      unusableColors([...palette.colors], inventory).map((c) => c.key)
    );
    for (const c of noOnes) expect(unusable.has(c.key)).toBe(true);
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
