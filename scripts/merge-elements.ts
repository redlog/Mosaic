/**
 * Merge LEGO element IDs into `src/lego/palette.data.json`.
 *
 *   npm run palette:elements -- elements.csv
 *
 * Element IDs are a lookup table, not a formula, so they have to come from
 * somewhere real — Rebrickable's `elements.csv`, a BrickLink export, or a
 * hand-kept sheet. This merges such a file into the palette in place, leaving
 * the colours themselves untouched.
 *
 * Required columns (header names are matched loosely and case-insensitively):
 *
 *   element_id   the number Pick a Brick wants
 *   part_num     the design ID — also accepted as design_id / part / design
 *   color        the colour — matched against the palette key, the colour
 *                name, or the BrickLink colour ID, in that order
 *
 * Rows naming a design or colour the palette does not carry are reported and
 * skipped rather than invented, and nothing is written if the result would
 * fail validation.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv, type CsvRow } from './palette-source';
import { validatePaletteFile } from '../src/lego/palette';
import { hasShape } from '../src/lego/parts';
import type { PaletteColorData, PaletteFile } from '../src/lego/types';

function field(row: CsvRow, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

export interface MergeReport {
  applied: number;
  unknownDesign: string[];
  unknownColor: string[];
  malformed: number;
}

/** Fold element rows into palette colours. Pure; the CLI does the file I/O. */
export function mergeElements(
  colors: PaletteColorData[],
  rows: readonly CsvRow[]
): MergeReport {
  const byKey = new Map(colors.map((c) => [c.key.toLowerCase(), c]));
  const byName = new Map(colors.map((c) => [c.name.toLowerCase(), c]));
  const byBlId = new Map(
    colors.filter((c) => c.blColorId !== null).map((c) => [String(c.blColorId), c])
  );

  const report: MergeReport = {
    applied: 0,
    unknownDesign: [],
    unknownColor: [],
    malformed: 0,
  };
  const unknownDesign = new Set<string>();
  const unknownColor = new Set<string>();

  for (const row of rows) {
    const elementId = field(row, 'element_id', 'elementid', 'element');
    const designId = field(row, 'part_num', 'design_id', 'designid', 'part', 'design');
    const colorRef = field(row, 'color', 'colour', 'color_key', 'color_name', 'color_id');

    if (!elementId || !designId || !colorRef || !/^\d+$/.test(elementId)) {
      report.malformed++;
      continue;
    }
    if (!hasShape(designId)) {
      unknownDesign.add(designId);
      continue;
    }

    const needle = colorRef.toLowerCase();
    const color = byKey.get(needle) ?? byName.get(needle) ?? byBlId.get(colorRef);
    if (!color) {
      unknownColor.add(colorRef);
      continue;
    }

    color.elements ??= {};
    color.elements[designId] = elementId;
    report.applied++;
  }

  report.unknownDesign = [...unknownDesign];
  report.unknownColor = [...unknownColor];
  return report;
}

async function main(argv: readonly string[]): Promise<number> {
  const dashdash = argv.indexOf('--');
  const args = dashdash === -1 ? [...argv] : argv.slice(dashdash + 1);

  const input = args.find((a) => !a.startsWith('--'));
  const outIndex = args.indexOf('--palette');
  const palettePath =
    outIndex === -1 ? 'src/lego/palette.data.json' : (args[outIndex + 1] ?? '');

  if (!input || !palettePath) {
    console.error(
      'usage: npm run palette:elements -- <elements.csv> [--palette src/lego/palette.data.json]\n' +
        '  columns: element_id, part_num (or design_id), color (key, name, or BrickLink id)'
    );
    return 1;
  }

  const file = JSON.parse(readFileSync(resolve(palettePath), 'utf8')) as PaletteFile;
  const rows = parseCsv(readFileSync(resolve(input), 'utf8'));
  const report = mergeElements(file.colors, rows);

  const { errors } = validatePaletteFile(file);
  if (errors.length > 0) {
    console.error(`Refusing to write ${palettePath} — ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }

  writeFileSync(resolve(palettePath), `${JSON.stringify(file, null, 2)}\n`);

  const slots = file.colors.reduce((sum, c) => sum + c.shapes.length, 0);
  const known = file.colors.reduce(
    (sum, c) => sum + c.shapes.filter((s) => c.elements?.[s]).length,
    0
  );
  console.log(`Applied ${report.applied} element IDs to ${palettePath}`);
  console.log(
    `Coverage: ${known}/${slots} (color, brick) pairs now have an element ID ` +
      `(${((known / slots) * 100).toFixed(0)}%)`
  );
  if (report.malformed > 0) console.warn(`Skipped ${report.malformed} malformed row(s)`);
  if (report.unknownDesign.length > 0) {
    console.warn(
      `Ignored design IDs not in the catalog: ${report.unknownDesign.join(', ')}`
    );
  }
  if (report.unknownColor.length > 0) {
    const shown = report.unknownColor.slice(0, 10).join(', ');
    console.warn(
      `Ignored colors not in the palette: ${shown}` +
        (report.unknownColor.length > 10
          ? `, and ${report.unknownColor.length - 10} more`
          : '')
    );
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  return 1;
});
