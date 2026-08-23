/**
 * Parts list as CSV, for a spreadsheet or a printed checklist.
 */
import type { Bom } from './bom';

export const CSV_HEADER = [
  'color_name',
  'bl_color_id',
  'part_name',
  'design_id',
  'quantity',
] as const;

export const CSV_MIME = 'text/csv;charset=utf-8';

/**
 * RFC 4180 field quoting: wrap in quotes when the value contains a comma,
 * a quote, or a line break, and double any embedded quotes.
 *
 * Part and color names are free text from a hand-editable data file, so this
 * cannot be skipped — "Red, Bright" would otherwise split into two columns and
 * silently shift every field after it.
 */
export function csvField(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(bom: Bom): string {
  const rows = [
    CSV_HEADER.join(','),
    ...bom.lines.map((line) =>
      [
        csvField(line.colorName),
        csvField(line.blColorId),
        csvField(line.partName),
        csvField(line.designId),
        csvField(line.quantity),
      ].join(',')
    ),
  ];
  // Trailing newline: POSIX text convention, and it stops spreadsheet
  // importers treating the last line as truncated.
  return `${rows.join('\n')}\n`;
}
