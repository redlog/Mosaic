/**
 * Parsing and assembly for palette source data.
 *
 * The CLI wrapper lives in build-palette.ts; everything here is pure so it can
 * be unit tested without touching the filesystem.
 *
 * Accepted inputs:
 *   - CSV with a header row. Required: `name` and one of `hex` / `rgb` /
 *     `color`. Optional: `key`, `bl_id` (or `bricklink_id` / `color_id`),
 *     `shapes`, `tier`.
 *   - JSON: either a complete palette file, or an array of the same records.
 */
import { isValidHex, rgbToHex } from '../src/lego/color';
import type { PaletteColorData, PaletteFile } from '../src/lego/types';

/**
 * Availability tiers.
 *
 * Real per-part availability needs catalog data. Where an export does not
 * carry it, these tiers stand in as a coarse, honest approximation: which
 * brick sizes a color of that commonness is typically produced in.
 */
export const TIERS: Readonly<Record<string, readonly string[]>> = {
  full: [
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
  ],
  broad: ['3005', '3004', '3622', '3010', '3009', '3008', '3003', '3002', '3001'],
  common: ['3005', '3004', '3622', '3010', '3003', '3001'],
  limited: ['3005', '3004', '3010', '3003'],
};

export type CsvRow = Record<string, string>;

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, embedded newlines. */
export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  // Spreadsheet exports leave a UTF-8 BOM on the first header cell, which
  // would otherwise become part of that column's name.
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') endField();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) endRow();

  const header = rows.shift();
  if (!header) return [];
  const keys = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
  );

  return rows.map((cells) => {
    const record: CsvRow = {};
    keys.forEach((k, i) => {
      record[k] = (cells[i] ?? '').trim();
    });
    return record;
  });
}

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Reads the first present field from a set of accepted aliases. */
function field(row: CsvRow, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

/** Accepts "#RRGGBB", "RRGGBB", or "r,g,b" / "r g b". */
export function normalizeHex(raw: string): string {
  const value = raw.trim();
  if (isValidHex(value)) {
    return value.startsWith('#') ? value.toUpperCase() : `#${value.toUpperCase()}`;
  }
  const parts = value
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (
    parts.length === 3 &&
    parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)
  ) {
    return rgbToHex([parts[0]!, parts[1]!, parts[2]!]);
  }
  throw new Error(`Cannot parse color value ${JSON.stringify(raw)}`);
}

export interface BuildOptions {
  id?: string;
  source?: string;
  verified?: boolean;
  defaultTier?: string;
  generated?: string;
}

/** Turn parsed records into a palette file, without writing anything. */
export function toPaletteFile(
  rows: readonly CsvRow[],
  options: BuildOptions = {}
): PaletteFile {
  const defaultTier = (options.defaultTier ?? 'common').toLowerCase();
  if (!TIERS[defaultTier]) {
    throw new Error(
      `Unknown tier ${JSON.stringify(defaultTier)}; expected one of ${Object.keys(TIERS).join(', ')}`
    );
  }

  const colors: PaletteColorData[] = rows.map((row, i) => {
    const name = field(row, 'name', 'color_name', 'colour');
    if (!name) throw new Error(`Row ${i + 1} has no \`name\``);

    const rawHex = field(row, 'hex', 'rgb', 'color', 'value');
    if (!rawHex) throw new Error(`Row ${i + 1} (${name}) has no \`hex\`/\`rgb\` value`);

    const rawId = field(
      row,
      'bl_id',
      'blcolorid',
      'bricklink_id',
      'bricklink',
      'color_id',
      'id'
    );
    const blColorId = rawId === undefined ? null : Number(rawId);
    if (blColorId !== null && !Number.isInteger(blColorId)) {
      throw new Error(`Row ${i + 1} (${name}) has a non-integer BrickLink ID: ${rawId}`);
    }

    const rawShapes = field(row, 'shapes', 'parts');
    const tier = (field(row, 'tier', 'availability') ?? defaultTier).toLowerCase();
    const tierShapes = TIERS[tier];
    if (!rawShapes && !tierShapes) {
      throw new Error(
        `Row ${i + 1} (${name}) has an unknown tier ${JSON.stringify(tier)}`
      );
    }

    return {
      key: field(row, 'key', 'slug') ?? slugify(name),
      name,
      hex: normalizeHex(rawHex),
      blColorId,
      shapes: rawShapes ? rawShapes.split(/[|;\s]+/).filter(Boolean) : [...tierShapes!],
    };
  });

  return {
    id: options.id ?? 'builtin-v1',
    provenance: {
      source: options.source ?? 'imported via scripts/build-palette.ts',
      generated: options.generated ?? new Date().toISOString().slice(0, 10),
      verified: options.verified ?? false,
      note: options.verified
        ? 'Checked against a real catalog export.'
        : 'UNVERIFIED. Hex values, BrickLink color IDs, and per-shape availability ' +
          'have not been confirmed against current production. Correct this file directly; ' +
          'nothing in the code depends on these values.',
    },
    colors,
  };
}

/** Parse whichever of the accepted input shapes this text is. */
export function parseInput(text: string, options: BuildOptions = {}): PaletteFile {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const json: unknown = JSON.parse(text);
    if (Array.isArray(json)) return toPaletteFile(json as CsvRow[], options);
    const file = json as PaletteFile;
    if (Array.isArray(file.colors)) return file;
    throw new Error('JSON input must be a palette file or an array of color records');
  }
  return toPaletteFile(parseCsv(text), options);
}
