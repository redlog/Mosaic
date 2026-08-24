import { hexToRgb, isValidHex, rgbToLab } from './color';
import { hasShape } from './parts';
import type {
  ColorFinish,
  LegoColor,
  PaletteColorData,
  PaletteFile,
  PaletteProvenance,
} from './types';
import paletteData from './palette.data.json';

export interface Palette {
  id: string;
  provenance: PaletteProvenance;
  colors: readonly LegoColor[];
  byKey: ReadonlyMap<string, LegoColor>;
  /**
   * Non-fatal problems worth showing the user — chiefly colors with no
   * known BrickLink ID.
   */
  warnings: readonly string[];
}

export interface PaletteValidation {
  errors: string[];
  warnings: string[];
}

const FINISHES: ReadonlySet<string> = new Set<ColorFinish>([
  'solid',
  'transparent',
  'metallic',
  'glitter',
  'glow',
]);

/**
 * A color whose last catalog year is older than this is treated as retired.
 *
 * One year of slack, not zero: the catalog year for a color still in
 * production ticks over with the sets that use it, so a color can legitimately
 * show last year = this year - 1 partway through a year.
 */
export const RETIRED_BEFORE = new Date().getUTCFullYear() - 1;

/**
 * Structural validation only.
 *
 * Deliberately says nothing about whether a hex value or BrickLink ID is
 * *correct* — that data is hand-maintained (see palette.data.json's
 * provenance note) and asserting specific values here would just freeze
 * today's guesses into the test suite.
 */
export function validatePaletteFile(file: unknown): PaletteValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof file !== 'object' || file === null) {
    return { errors: ['Palette file must be an object'], warnings };
  }

  const f = file as Partial<PaletteFile>;
  if (typeof f.id !== 'string' || f.id.length === 0) {
    errors.push('Palette file needs a non-empty string `id`');
  }
  if (!Array.isArray(f.colors)) {
    return { errors: [...errors, 'Palette file needs a `colors` array'], warnings };
  }
  if (f.colors.length === 0) {
    errors.push('Palette contains no colors');
  }

  const seen = new Set<string>();
  for (const [i, raw] of f.colors.entries()) {
    const where = `colors[${i}]`;
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${where} is not an object`);
      continue;
    }
    const c = raw as Partial<PaletteColorData>;

    if (typeof c.key !== 'string' || c.key.length === 0) {
      errors.push(`${where} needs a non-empty \`key\``);
    } else if (seen.has(c.key)) {
      errors.push(`${where} duplicates key "${c.key}"`);
    } else {
      seen.add(c.key);
    }

    const label = typeof c.key === 'string' ? c.key : where;

    if (typeof c.name !== 'string' || c.name.length === 0) {
      errors.push(`${label} needs a non-empty \`name\``);
    }
    if (typeof c.hex !== 'string' || !isValidHex(c.hex)) {
      errors.push(`${label} has an invalid \`hex\`: ${JSON.stringify(c.hex)}`);
    }

    if (c.blColorId === null) {
      warnings.push(`${label} has no known BrickLink color ID`);
    } else if (typeof c.blColorId !== 'number' || !Number.isInteger(c.blColorId)) {
      errors.push(`${label} \`blColorId\` must be an integer or null`);
    }

    if (c.trans !== undefined && typeof c.trans !== 'boolean') {
      errors.push(`${label} \`trans\` must be a boolean`);
    }
    if (c.finish !== undefined && !FINISHES.has(c.finish)) {
      errors.push(`${label} has an unknown \`finish\`: ${JSON.stringify(c.finish)}`);
    }
    if (c.years !== undefined) {
      const y = c.years as unknown;
      if (
        !Array.isArray(y) ||
        y.length !== 2 ||
        !y.every((n) => Number.isInteger(n)) ||
        y[0] > y[1]
      ) {
        errors.push(`${label} \`years\` must be [first, last] with first <= last`);
      }
    }

    if (c.elements !== undefined) {
      if (typeof c.elements !== 'object' || c.elements === null) {
        errors.push(`${label} \`elements\` must be an object keyed by design ID`);
      } else {
        for (const [designId, elementId] of Object.entries(c.elements)) {
          if (!hasShape(designId)) {
            errors.push(`${label} has an element for unknown design ID "${designId}"`);
          }
          if (typeof elementId !== 'string' || !/^\d+$/.test(elementId)) {
            errors.push(
              `${label} element for ${designId} must be a digit string, got ${JSON.stringify(elementId)}`
            );
          }
        }
      }
    }

    if (!Array.isArray(c.shapes) || c.shapes.length === 0) {
      errors.push(`${label} needs a non-empty \`shapes\` array`);
    } else {
      for (const id of c.shapes) {
        if (typeof id !== 'string' || !hasShape(id)) {
          errors.push(`${label} lists unknown design ID ${JSON.stringify(id)}`);
        }
      }
    }
  }

  return { errors, warnings };
}

export interface LoadPaletteOptions {
  /** Per-key hex corrections, applied on top of the file's values. */
  overrides?: ReadonlyArray<{ key: string; hex: string }>;
  /** Substitute palette data, for tests or a user-supplied file. */
  data?: unknown;
}

/**
 * Parse a palette file, precompute RGB and Lab, and index it by key.
 * Throws on structural errors — a malformed palette would produce silently
 * wrong color matching downstream, so it fails loudly and early.
 */
export function loadPalette(options: LoadPaletteOptions = {}): Palette {
  const source = options.data ?? paletteData;
  const { errors, warnings } = validatePaletteFile(source);
  if (errors.length > 0) {
    throw new Error(`Invalid palette data:\n  ${errors.join('\n  ')}`);
  }

  const file = source as PaletteFile;
  const overrides = new Map(
    (options.overrides ?? []).map((o) => [o.key, o.hex] as const)
  );

  const allWarnings = [...warnings];
  if (!file.provenance?.verified) {
    allWarnings.push(
      'Palette data is unverified — check hex values and BrickLink IDs before ordering'
    );
  } else if (file.provenance.bricklinkVerified === false) {
    allWarnings.push(
      'BrickLink color IDs are hand-maintained and unverified — check them before ' +
        'relying on them. Everything else in the palette comes from the catalog.'
    );
  }

  const colors: LegoColor[] = file.colors.map((c) => {
    const override = overrides.get(c.key);
    if (override !== undefined && !isValidHex(override)) {
      throw new Error(`Override for "${c.key}" has an invalid hex: ${override}`);
    }
    const hex = override ?? c.hex;
    const rgb = hexToRgb(hex);
    return { ...c, hex, rgb, lab: rgbToLab(rgb) };
  });

  return {
    id: file.id,
    provenance: file.provenance,
    colors,
    byKey: new Map(colors.map((c) => [c.key, c])),
    warnings: allWarnings,
  };
}

/**
 * Whether a color is still being produced, so far as the catalog says.
 * A color with no year data is assumed current — a hand-maintained palette
 * that omits the field should behave as it always did.
 */
export function isCurrent(color: Pick<LegoColor, 'years'>): boolean {
  return color.years === undefined || color.years[1] >= RETIRED_BEFORE;
}

/**
 * The colors switched on for a new project.
 *
 * The palette ships everything the catalog has, so that no choice is ever
 * closed off; this is the subset that makes sense to quantize a photograph
 * against by default. Two exclusions, both about matching rather than
 * availability:
 *
 * - **Retired colors.** Real parts, orderable secondhand, but not something
 *   you can add to a lego.com basket. Left available, switched off.
 * - **Non-solid finishes.** Chrome, pearl, transparent and glitter bricks show
 *   the room or whatever is behind them, so their nominal RGB is not what the
 *   eye sees — and several of them collide exactly with a solid color's value
 *   (Trans-Red and Red are both #C91A09), which would make the match between
 *   them arbitrary.
 */
export function defaultColorKeys(colors: readonly LegoColor[]): string[] {
  return colors
    .filter((c) => (c.finish ?? 'solid') === 'solid' && isCurrent(c))
    .map((c) => c.key);
}

/** The subset of a palette the user has switched on; all of it if unspecified. */
export function enabledColors(palette: Palette, keys?: readonly string[]): LegoColor[] {
  if (!keys) return [...palette.colors];
  const wanted = new Set(keys);
  return palette.colors.filter((c) => wanted.has(c.key));
}

/**
 * Which of `inventory` may be used for this color.
 *
 * Under `strict`, this is the intersection with the color's real availability,
 * which is what keeps the parts list orderable. Without it, the full inventory
 * is allowed and the export layer flags anything questionable.
 */
export function legalShapes(
  color: Pick<LegoColor, 'shapes'>,
  inventory: readonly string[],
  strict: boolean
): string[] {
  if (!strict) return [...inventory];
  const available = new Set(color.shapes);
  return inventory.filter((id) => available.has(id));
}

/**
 * The 1x1. Every other shape is optional; this one is the fallback that makes
 * an arbitrary region coverable, which is why `assertCoverable` insists on it.
 */
export const REQUIRED_DESIGN_ID = '3005';

/**
 * Colors that would be unusable under strict availability with this inventory.
 * The UI auto-disables these rather than letting the tiler fail mid-run.
 *
 * Two ways to be unusable, and the second is not obvious: a color with no legal
 * shape at all, and a color that has some but not the 1x1. Flat Silver is real
 * in a 2x2, a 2x4 and a 1x6 and in nothing smaller, so a single stray Flat
 * Silver cell leaves a hole no brick in that color can fill. Colors like that
 * used to be impossible to express — the availability data was a coarse tier
 * estimate that gave every color a 1x1 — and became reachable the moment the
 * palette started carrying real per-shape data.
 */
export function unusableColors(
  colors: readonly LegoColor[],
  inventory: readonly string[]
): LegoColor[] {
  return colors.filter(
    (c) =>
      legalShapes(c, inventory, true).length === 0 ||
      !c.shapes.includes(REQUIRED_DESIGN_ID)
  );
}

/** The element ID for a (color, design) pair, or null when it is not known. */
export function elementIdFor(
  color: Pick<LegoColor, 'elements'>,
  designId: string
): string | null {
  return color.elements?.[designId] ?? null;
}

/**
 * How much of a palette carries element IDs, as a fraction of the
 * (color, shape) pairs it claims to be available in. Drives the coverage note
 * on the Pick a Brick export.
 */
export function elementCoverage(colors: readonly LegoColor[]): {
  known: number;
  total: number;
} {
  let known = 0;
  let total = 0;
  for (const color of colors) {
    for (const designId of color.shapes) {
      total++;
      if (elementIdFor(color, designId)) known++;
    }
  }
  return { known, total };
}

/** Colors with no known BrickLink color ID. */
export function colorsMissingBricklinkId(colors: readonly LegoColor[]): LegoColor[] {
  return colors.filter((c) => c.blColorId === null);
}
