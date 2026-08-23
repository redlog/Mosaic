/**
 * Pick a Brick CSV, for import at lego.com.
 *
 * The format is exactly two columns:
 *
 *     elementId,quantity
 *     300321,18
 *     300121,999
 *
 * **Element IDs, not design IDs.** A design ID names a shape — 3001 is the
 * 2x4 brick in every colour there is. An element ID names one specific
 * (shape, colour) pair, which is what an order actually consists of. Pick a
 * Brick imports elements; a design ID pasted into it is either rejected or,
 * worse, matches something unintended.
 *
 * The two are not derivable from each other. Many classic elements do read as
 * the design ID with a LEGO colour number stuck on the end — 3001 in Bright
 * Red is 300121, 3003 is 300321 — but modern parts get seven-digit sequential
 * IDs that follow no pattern at all. So this exporter looks IDs up and omits
 * what it cannot find, exactly as the BrickLink exporter does with colour IDs.
 * Guessing here would order the wrong part in silence.
 */
import type { Bom } from './bom';
import type { BomLine } from './types';

export const PICKABRICK_MIME = 'text/csv;charset=utf-8';
export const PICKABRICK_HEADER = ['elementId', 'quantity'] as const;

/**
 * Pick a Brick caps how many of one element a single order line may hold.
 * Quantities above this are split across repeated rows rather than clamped —
 * losing bricks silently would be worse than a longer file.
 */
export const PICKABRICK_MAX_PER_LINE = 999;

export interface PickABrickExport {
  csv: string;
  /** Lines that made it into the file. */
  included: BomLine[];
  /** Lines dropped for want of an element ID. */
  omitted: BomLine[];
  /** Rows emitted, which exceeds `included.length` when quantities are split. */
  rows: number;
  warnings: string[];
}

export function toPickABrickCsv(bom: Bom): PickABrickExport {
  const included: BomLine[] = [];
  const omitted: BomLine[] = [];
  for (const line of bom.lines) {
    (line.elementId ? included : omitted).push(line);
  }

  const rows: string[] = [];
  for (const line of included) {
    let remaining = line.quantity;
    while (remaining > 0) {
      const take = Math.min(remaining, PICKABRICK_MAX_PER_LINE);
      rows.push(`${line.elementId!},${take}`);
      remaining -= take;
    }
  }

  const warnings: string[] = [];
  if (omitted.length > 0) {
    const bricks = omitted.reduce((sum, l) => sum + l.quantity, 0);
    const parts = [
      ...new Set(
        omitted.map((l) => `${l.partName.replace('Brick ', '')} in ${l.colorName}`)
      ),
    ];
    // One message, not two: when everything is omitted the second half explains
    // why the file is empty, rather than repeating the first half back.
    warnings.push(
      `Omitted ${omitted.length} ${omitted.length === 1 ? 'lot' : 'lots'} ` +
        `(${bricks} ${bricks === 1 ? 'brick' : 'bricks'}) with no known element ID: ` +
        `${parts.slice(0, 4).join(', ')}${parts.length > 4 ? `, and ${parts.length - 4} more` : ''}. ` +
        (included.length === 0
          ? 'That is the whole build, so there is nothing to import — element IDs ' +
            'are a lookup table, not a formula. See the README for how to load one.'
          : 'Add element IDs to palette.data.json to include them.')
    );
  }

  return {
    csv: `${[PICKABRICK_HEADER.join(','), ...rows].join('\n')}\n`,
    included,
    omitted,
    rows: rows.length,
    warnings,
  };
}
