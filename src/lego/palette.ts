import { hexToRgb, isValidHex, rgbToLab } from './color';
import { hasShape } from './parts';
import type {
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
   * BrickLink ID, which cannot appear in a Wanted List export.
   */
  warnings: readonly string[];
}

export interface PaletteValidation {
  errors: string[];
  warnings: string[];
}

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
      warnings.push(
        `${label} has no BrickLink color ID and will be omitted from XML export`
      );
    } else if (typeof c.blColorId !== 'number' || !Number.isInteger(c.blColorId)) {
      errors.push(`${label} \`blColorId\` must be an integer or null`);
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
 * Colors that would be unusable under strict availability with this inventory.
 * The UI auto-disables these rather than letting the tiler fail mid-run.
 */
export function unusableColors(
  colors: readonly LegoColor[],
  inventory: readonly string[]
): LegoColor[] {
  return colors.filter((c) => legalShapes(c, inventory, true).length === 0);
}

/** Colors that cannot be emitted into a BrickLink Wanted List. */
export function colorsMissingBricklinkId(colors: readonly LegoColor[]): LegoColor[] {
  return colors.filter((c) => c.blColorId === null);
}
