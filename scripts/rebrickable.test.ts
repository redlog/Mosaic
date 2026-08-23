import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPalette,
  checkCatalog,
  chooseElements,
  classifyFinish,
  parseBricklinkIds,
  sortKey,
  type RebrickableSources,
} from './rebrickable';
import { validatePaletteFile } from '../src/lego/palette';
import { BRICK_SHAPES } from '../src/lego/parts';
import { parseCsv } from './palette-source';
import type { PaletteFile } from '../src/lego/types';

const DATA = 'data/rebrickable';
const read = (name: string): string => readFileSync(resolve(DATA, name), 'utf8');

const shipped = (): RebrickableSources => ({
  colors: read('colors.csv'),
  parts: read('parts.csv'),
  elements: read('elements.csv'),
  bricklink: readFileSync(resolve('data/bricklink-color-ids.csv'), 'utf8'),
});

const PARTS_CSV =
  'part_num,name,part_cat_id,part_material\n' +
  BRICK_SHAPES.map((s) => `${s.designId},${s.name},11,Plastic`).join('\n') +
  '\n';

describe('classifyFinish', () => {
  it('reads the finish out of the catalog name', () => {
    expect(classifyFinish('Red', false)).toBe('solid');
    expect(classifyFinish('Trans-Red', true)).toBe('transparent');
    expect(classifyFinish('Chrome Gold', false)).toBe('metallic');
    expect(classifyFinish('Pearl Gold', false)).toBe('metallic');
    expect(classifyFinish('Flat Silver', false)).toBe('metallic');
    expect(classifyFinish('Opal Trans-Clear', true)).toBe('glitter');
    expect(classifyFinish('Glow In Dark Opaque', false)).toBe('glow');
  });

  it('does not mistake a color name that merely starts the same way', () => {
    // "Coral" begins with Co, "Copper" is the metallic — prefixes are matched
    // on word boundaries so one cannot swallow the other.
    expect(classifyFinish('Coral', false)).toBe('solid');
    expect(classifyFinish('Copper', false)).toBe('metallic');
    expect(classifyFinish('Medium Nougat', false)).toBe('solid');
  });
});

describe('checkCatalog', () => {
  it('passes on the shipped extract', () => {
    expect(checkCatalog(read('parts.csv'))).toEqual([]);
  });

  it('reports a design ID the extract does not have', () => {
    const missing = PARTS_CSV.split('\n')
      .filter((l) => !l.startsWith('3001,'))
      .join('\n');
    expect(checkCatalog(missing).join()).toMatch(/3001 \(Brick 2 x 4\) is not in parts/);
  });

  it('reports a name that disagrees with the catalog', () => {
    const renamed = PARTS_CSV.replace('3001,Brick 2 x 4', '3001,Brick 2 x 5');
    expect(checkCatalog(renamed).join()).toMatch(/3001 is "Brick 2 x 5"/);
  });
});

describe('chooseElements', () => {
  const catalog = new Set(['3001', '3005']);
  const rows = parseCsv(
    'element_id,part_num,color_id,design_id\n' +
      '300101,3001,15,3001\n' +
      '6552094,3001,15,3001\n' +
      '300126,3001,0,3001\n' +
      '999,4073,15,4073\n' +
      'not-a-number,3005,15,\n'
  );

  it('keeps the newest element ID for a reissued pair', () => {
    // Both name Brick 2 x 4 in White; only the later one is still listed.
    expect(chooseElements(rows, catalog).get('15')?.elements.get('3001')).toBe('6552094');
  });

  it('counts what it superseded rather than dropping it silently', () => {
    expect(chooseElements(rows, catalog).get('15')?.superseded).toBe(1);
  });

  it('groups by color and ignores parts outside the catalog', () => {
    const grouped = chooseElements(rows, catalog);
    expect(grouped.get('0')?.elements.get('3001')).toBe('300126');
    expect([...grouped.keys()].sort()).toEqual(['0', '15']);
  });

  it('skips rows whose element ID is not a number', () => {
    expect(chooseElements(rows, catalog).get('15')?.elements.has('3005')).toBe(false);
  });
});

describe('parseBricklinkIds', () => {
  it('reads the name -> ID table', () => {
    const map = parseBricklinkIds('rebrickable_name,bl_color_id\nRed,5\nDark Tan,69\n');
    expect(map.get('Red')).toBe(5);
    expect(map.get('Dark Tan')).toBe(69);
  });

  it('refuses a non-integer ID rather than writing NaN into the palette', () => {
    expect(() => parseBricklinkIds('rebrickable_name,bl_color_id\nRed,five\n')).toThrow(
      /non-integer/
    );
  });
});

describe('sortKey', () => {
  it('puts neutrals first, then hues, then the non-solid finishes', () => {
    const white = sortKey('#FFFFFF', 'solid');
    const red = sortKey('#C91A09', 'solid');
    const chrome = sortKey('#E0E0E0', 'metallic');
    const trans = sortKey('#C91A09', 'transparent');
    expect(white[0]).toBe(0);
    expect(red[0]).toBe(1);
    expect(chrome[0]).toBe(2);
    expect(trans[0]).toBe(3);
  });

  it('orders neutrals light to dark', () => {
    expect(sortKey('#FFFFFF', 'solid')[2]).toBeLessThan(sortKey('#05131D', 'solid')[2]);
  });

  it('does not let a near-neutral land at a random point on the hue circle', () => {
    // #FCFCFC has a hue angle, but it is noise; it belongs with the pale
    // colors, not between the greens and the blues.
    expect(sortKey('#FCFCFC', 'transparent')[1]).toBe(-1);
    expect(sortKey('#0020A0', 'transparent')[1]).toBeGreaterThanOrEqual(0);
  });
});

describe('buildPalette', () => {
  const minimal: RebrickableSources = {
    parts: PARTS_CSV,
    colors:
      'id,name,rgb,is_trans,num_parts,num_sets,y1,y2\n' +
      '4,Red,C91A09,False,10,10,1949,2027\n' +
      '47,Trans-Clear,FCFCFC,True,10,10,1954,2026\n' +
      '9999,Nothing Uses This,123456,False,0,0,2000,2001\n',
    elements:
      'element_id,part_num,color_id,design_id\n' +
      '300121,3001,4,3001\n' +
      '300521,3005,4,3005\n' +
      '300547,3005,47,3005\n',
    bricklink: 'rebrickable_name,bl_color_id\nRed,5\n',
  };

  it('keeps only colors an element actually exists for', () => {
    const { file, report } = buildPalette(minimal);
    expect(file.colors.map((c) => c.key)).toEqual(['red', 'trans-clear']);
    expect(report.skippedColors).toBe(1);
  });

  it('derives availability from the elements, not from a guess', () => {
    const { file } = buildPalette(minimal);
    const red = file.colors.find((c) => c.key === 'red')!;
    expect(red.shapes).toEqual(['3005', '3001']);
    expect(red.elements).toEqual({ '3005': '300521', '3001': '300121' });
  });

  it('lists shapes in catalog order however the rows arrive', () => {
    const { file } = buildPalette(minimal);
    const order = BRICK_SHAPES.map((s) => s.designId);
    for (const color of file.colors) {
      const ranks = color.shapes.map((id) => order.indexOf(id));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('carries the finish, transparency and production span through', () => {
    const { file } = buildPalette(minimal);
    const trans = file.colors.find((c) => c.key === 'trans-clear')!;
    expect(trans.trans).toBe(true);
    expect(trans.finish).toBe('transparent');
    expect(trans.years).toEqual([1954, 2026]);
  });

  it('leaves an unmapped BrickLink ID null rather than inventing one', () => {
    const { file, report } = buildPalette(minimal);
    expect(file.colors.find((c) => c.key === 'red')!.blColorId).toBe(5);
    expect(file.colors.find((c) => c.key === 'trans-clear')!.blColorId).toBeNull();
    expect(report.missingBricklinkIds).toEqual(['Trans-Clear']);
  });

  it('marks the catalog data verified and the BrickLink IDs not', () => {
    const { file } = buildPalette(minimal);
    expect(file.provenance.verified).toBe(true);
    expect(file.provenance.bricklinkVerified).toBe(false);
  });

  it('refuses to build against an extract missing a catalog brick', () => {
    const broken = { ...minimal, parts: 'part_num,name,part_cat_id,part_material\n' };
    expect(() => buildPalette(broken)).toThrow(/does not match parts.csv/);
  });
});

describe('the shipped palette', () => {
  const { file, report } = buildPalette(shipped(), { retrieved: '2026-08-23' });

  it('is what is checked in', () => {
    // Guards against palette.data.json being hand-edited, or the extract being
    // refreshed without rerunning the build. `npm run palette:build` fixes it.
    // Provenance is excluded because it records the day it was generated.
    const onDisk = JSON.parse(
      readFileSync(resolve('src/lego/palette.data.json'), 'utf8')
    ) as PaletteFile;
    expect(file.colors).toEqual(onDisk.colors);
    expect(file.id).toBe(onDisk.id);
  });

  it('validates', () => {
    expect(validatePaletteFile(file).errors).toEqual([]);
  });

  it('covers every pair it lists with an element ID', () => {
    expect(report.pairs).toBeGreaterThan(0);
    for (const color of file.colors) {
      expect(Object.keys(color.elements ?? {})).toHaveLength(color.shapes.length);
    }
  });

  it('has the everyday colors in every brick in the catalog', () => {
    for (const key of ['white', 'black', 'red', 'light-bluish-gray']) {
      const color = file.colors.find((c) => c.key === key)!;
      expect(color.shapes).toHaveLength(BRICK_SHAPES.length);
    }
  });
});
