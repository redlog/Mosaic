/**
 * Build `src/lego/palette.data.json` from the Rebrickable catalog extract in
 * `data/rebrickable/`.
 *
 * This is the authoritative path. Everything the palette claims about a color —
 * its RGB value, which brick shapes it exists in, and the element ID for each
 * of those pairs — is read out of the catalog rather than estimated. A color
 * appears in the palette only if LEGO has actually issued an element for it in
 * at least one brick in `BRICK_SHAPES`, which is what makes "this parts list is
 * orderable" a property of the data instead of a hope.
 *
 * The CLI wrapper is build-palette.ts; everything here is pure so it can be
 * tested without touching the filesystem.
 *
 * ## What is *not* derived from the catalog
 *
 * BrickLink color IDs. Rebrickable's `colors.csv` `id` column is Rebrickable's
 * own numbering (it matches the LDraw code for the classic range); it is
 * neither the LEGO color number nor the BrickLink one, and no arithmetic turns
 * one into the other. They come from `data/bricklink-color-ids.csv`, a
 * hand-maintained name -> ID table, and colors missing from it get `null` —
 * which the XML export skips rather than guessing, because a wrong ID orders
 * the wrong color and nothing downstream can catch it.
 */
import { BRICK_SHAPES } from '../src/lego/parts';
import { hexToRgb, rgbToLab } from '../src/lego/color';
import { parseCsv, slugify, type CsvRow } from './palette-source';
import type { ColorFinish, PaletteColorData, PaletteFile } from '../src/lego/types';

/** The catalog extract, as raw file contents. */
export interface RebrickableSources {
  colors: string;
  parts: string;
  elements: string;
  /** `rebrickable_name,bl_color_id`. Optional; without it every ID is null. */
  bricklink?: string;
}

export interface RebrickableOptions {
  id?: string;
  /** ISO date recorded in provenance. Defaults to today. */
  generated?: string;
  /** Date the catalog extract was retrieved, for the provenance note. */
  retrieved?: string;
}

export interface BuildReport {
  /** Colors kept, i.e. those with at least one element in a catalog brick. */
  colors: number;
  /** (color, brick) pairs, every one of which carries an element ID. */
  pairs: number;
  /** Element rows that were superseded by a newer ID for the same pair. */
  supersededElements: number;
  /** Kept colors with no entry in the BrickLink table. */
  missingBricklinkIds: string[];
  /** Colors in the extract with no element in any catalog brick. */
  skippedColors: number;
}

/**
 * Non-solid finishes, matched against the Rebrickable color name.
 *
 * These are surface treatments, not colors: a chrome brick's appearance is
 * mostly the room reflected in it, so matching one to a photographed pixel by
 * Lab distance is meaningless however close the nominal RGB value sits. The
 * finish is recorded rather than dropped — the parts exist and the data should
 * say so — and `defaultColorKeys()` is what leaves them switched off.
 */
const GLOW = /\bGlow\b/i;
const GLITTER = /^(?:Glitter|Opal)\b/;
const METALLIC =
  /^(?:Chrome|Metallic|Pearl|Satin|Speckle|Two-tone|Metal|Copper|Reddish Gold|Flat Silver|Flat Dark Gold)\b/;

export function classifyFinish(name: string, isTrans: boolean): ColorFinish {
  if (GLOW.test(name)) return 'glow';
  if (GLITTER.test(name)) return 'glitter';
  if (isTrans) return 'transparent';
  if (METALLIC.test(name)) return 'metallic';
  return 'solid';
}

/** Rebrickable writes booleans as the Python literals `True` / `False`. */
const isTrue = (value: string | undefined): boolean => value?.toLowerCase() === 'true';

const year = (value: string | undefined): number | null => {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

/**
 * Guards against a catalog extract that does not describe the bricks this app
 * ships. A silently absent part number would show up as a color that "exists"
 * in fewer shapes than it really does, which is exactly the failure this whole
 * pipeline is meant to rule out.
 */
export function checkCatalog(partsCsv: string): string[] {
  const byNum = new Map(parseCsv(partsCsv).map((r) => [r.part_num ?? '', r]));
  const problems: string[] = [];
  for (const shape of BRICK_SHAPES) {
    const row = byNum.get(shape.designId);
    if (!row) {
      problems.push(`${shape.designId} (${shape.name}) is not in parts.csv`);
    } else if (row.name !== shape.name) {
      problems.push(
        `${shape.designId} is "${row.name}" in parts.csv but "${shape.name}" in parts.ts`
      );
    }
  }
  return problems;
}

/** `rebrickable_name` -> BrickLink color ID. */
export function parseBricklinkIds(csv: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of parseCsv(csv)) {
    const name = row.rebrickable_name ?? row.name;
    const raw = row.bl_color_id ?? row.bl_id;
    if (!name || !raw) continue;
    const id = Number(raw);
    if (!Number.isInteger(id)) {
      throw new Error(
        `BrickLink table: ${name} has a non-integer ID ${JSON.stringify(raw)}`
      );
    }
    map.set(name, id);
  }
  return map;
}

interface Grouped {
  /** designId -> chosen element ID. */
  elements: Map<string, string>;
  superseded: number;
}

/**
 * Collapse the element rows for one color down to one ID per brick.
 *
 * A (part, color) pair accumulates an element ID every time LEGO reissues it —
 * Brick 2 x 4 in White is both `300101` and `6552094`. All of them name the
 * same brick in the same color, so any would order correctly, but only the
 * current one is listed on Pick a Brick. Element IDs are assigned in ascending
 * order over time, so the largest is the most recently issued and the one most
 * likely to still resolve.
 */
export function chooseElements(
  rows: readonly CsvRow[],
  catalog: ReadonlySet<string>
): Map<string, Grouped> {
  const byColor = new Map<string, Grouped>();

  for (const row of rows) {
    const designId = row.part_num ?? '';
    const colorId = row.color_id ?? '';
    const elementId = row.element_id ?? '';
    if (!catalog.has(designId) || colorId === '' || !/^\d+$/.test(elementId)) continue;

    let group = byColor.get(colorId);
    if (!group) {
      group = { elements: new Map(), superseded: 0 };
      byColor.set(colorId, group);
    }
    const current = group.elements.get(designId);
    if (current === undefined) {
      group.elements.set(designId, elementId);
    } else {
      group.superseded++;
      if (Number(elementId) > Number(current)) group.elements.set(designId, elementId);
    }
  }

  return byColor;
}

/**
 * Palette order, which is also the order the parts list is grouped in.
 *
 * Neutrals first, lightest to darkest, then the chromatic colors around the
 * hue circle from red, then the finishes that are not flat color. Derived from
 * Lab rather than hand-sorted so that adding a color to the catalog does not
 * mean deciding where it goes.
 */
const NEUTRAL_CHROMA = 12;
const HUE_SECTORS = 12;

export function sortKey(hex: string, finish: ColorFinish): [number, number, number] {
  const [l, a, b] = rgbToLab(hexToRgb(hex));
  const chroma = Math.hypot(a, b);
  const hue = (Math.atan2(b, a) * (180 / Math.PI) + 360) % 360;
  const sector = Math.floor((hue / 360) * HUE_SECTORS);

  // Hue is meaningless at near-zero chroma — the angle of #FCFCFC is noise —
  // so near-neutrals lead their group by lightness instead of landing at a
  // random point on the hue circle.
  const bin = chroma < NEUTRAL_CHROMA ? -1 : sector;

  if (finish === 'metallic') return [2, bin, -l];
  if (finish !== 'solid') return [3, bin, -l];
  if (bin === -1) return [0, 0, -l];
  return [1, bin, -l];
}

function compareKeys(x: readonly number[], y: readonly number[]): number {
  for (let i = 0; i < x.length; i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function buildPalette(
  sources: RebrickableSources,
  options: RebrickableOptions = {}
): { file: PaletteFile; report: BuildReport } {
  const problems = checkCatalog(sources.parts);
  if (problems.length > 0) {
    throw new Error(`Catalog does not match parts.csv:\n  ${problems.join('\n  ')}`);
  }

  const catalogOrder = BRICK_SHAPES.map((s) => s.designId);
  const catalog = new Set(catalogOrder);
  const grouped = chooseElements(parseCsv(sources.elements), catalog);
  const bricklink = sources.bricklink ? parseBricklinkIds(sources.bricklink) : new Map();

  const report: BuildReport = {
    colors: 0,
    pairs: 0,
    supersededElements: 0,
    missingBricklinkIds: [],
    skippedColors: 0,
  };

  const entries: Array<{ key: [number, number, number]; color: PaletteColorData }> = [];
  const usedKeys = new Set<string>();

  for (const row of parseCsv(sources.colors)) {
    const id = row.id ?? '';
    const name = row.name ?? '';
    const group = grouped.get(id);
    if (!name) continue;
    if (!group || group.elements.size === 0) {
      report.skippedColors++;
      continue;
    }

    const hex = `#${(row.rgb ?? '').toUpperCase()}`;
    const trans = isTrue(row.is_trans);
    const finish = classifyFinish(name, trans);

    // Rebrickable names are unique, so a slug collision means two names that
    // differ only in punctuation — worth failing on rather than silently
    // dropping one of them.
    const key = slugify(name);
    if (usedKeys.has(key)) throw new Error(`Two colors slugify to "${key}"`);
    usedKeys.add(key);

    const shapes = catalogOrder.filter((designId) => group.elements.has(designId));
    const elements: Record<string, string> = {};
    for (const designId of shapes) elements[designId] = group.elements.get(designId)!;

    const first = year(row.y1);
    const last = year(row.y2);
    const blColorId = bricklink.get(name) ?? null;
    if (blColorId === null) report.missingBricklinkIds.push(name);

    const color: PaletteColorData = {
      key,
      name,
      hex,
      blColorId,
      trans,
      finish,
      ...(first !== null && last !== null
        ? { years: [first, last] as [number, number] }
        : {}),
      shapes,
      elements,
    };

    report.colors++;
    report.pairs += shapes.length;
    report.supersededElements += group.superseded;
    entries.push({ key: sortKey(hex, finish), color });
  }

  entries.sort((x, y) => compareKeys(x.key, y.key));

  const retrieved =
    options.retrieved ?? 'the date recorded in data/rebrickable/README.md';
  const file: PaletteFile = {
    id: options.id ?? 'rebrickable-v1',
    provenance: {
      source: `Rebrickable catalog extract (data/rebrickable/), retrieved ${retrieved}`,
      generated: options.generated ?? new Date().toISOString().slice(0, 10),
      verified: true,
      bricklinkVerified: false,
      note:
        'Colors, per-shape availability and element IDs are read from the Rebrickable ' +
        'catalog, not estimated: a color is listed only in the brick shapes LEGO has ' +
        'actually issued an element for, and every (color, brick) pair carries that ' +
        "element ID. BrickLink color IDs are the exception — Rebrickable's color " +
        'numbering is its own and does not convert, so they come from the ' +
        'hand-maintained data/bricklink-color-ids.csv and are unverified; colors ' +
        'missing from that table carry null and are left out of the Wanted List ' +
        'export rather than guessed. Regenerate with `npm run palette:build`.',
    },
    colors: entries.map((e) => e.color),
  };

  return { file, report };
}
