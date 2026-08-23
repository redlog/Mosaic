/**
 * BrickLink Wanted List XML.
 *
 * The highest-value export in the app: uploaded to BrickLink, this prices and
 * sources the entire build in one step, which is where real pricing lives
 * (DESIGN.md §11.2).
 *
 * It is also the export where being wrong is worst. A bad COLOR id does not
 * fail — it silently orders the wrong color. So a line with no BrickLink ID is
 * omitted and reported rather than guessed.
 */
import type { Bom } from './bom';
import type { BomLine } from './types';

export const BRICKLINK_MIME = 'application/xml';

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);
}

export interface BricklinkExport {
  xml: string;
  /** Lines that made it into the file. */
  included: BomLine[];
  /** Lines dropped for want of a BrickLink color ID. */
  omitted: BomLine[];
  warnings: string[];
}

export function toBricklinkXml(bom: Bom): BricklinkExport {
  const included: BomLine[] = [];
  const omitted: BomLine[] = [];
  for (const line of bom.lines) {
    (line.blColorId === null ? omitted : included).push(line);
  }

  const items = included.map(
    (line) =>
      '  <ITEM>\n' +
      '    <ITEMTYPE>P</ITEMTYPE>\n' +
      `    <ITEMID>${xmlEscape(line.designId)}</ITEMID>\n` +
      `    <COLOR>${line.blColorId!}</COLOR>\n` +
      `    <MINQTY>${line.quantity}</MINQTY>\n` +
      '  </ITEM>'
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${items.join('\n')}${
    items.length > 0 ? '\n' : ''
  }</INVENTORY>\n`;

  const warnings: string[] = [];
  if (omitted.length > 0) {
    const bricks = omitted.reduce((sum, l) => sum + l.quantity, 0);
    const colors = [...new Set(omitted.map((l) => l.colorName))];
    warnings.push(
      `Omitted ${omitted.length} ${omitted.length === 1 ? 'line' : 'lines'} ` +
        `(${bricks} ${bricks === 1 ? 'brick' : 'bricks'}) with no BrickLink color ID: ` +
        `${colors.join(', ')}. Add the IDs to palette.data.json to include them.`
    );
  }
  if (included.length === 0) {
    warnings.push('Nothing to export — no line has a BrickLink color ID');
  }

  return { xml, included, omitted, warnings };
}
