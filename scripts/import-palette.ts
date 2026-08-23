/**
 * Import a palette from an arbitrary color sheet.
 *
 *   npm run palette:import -- <input.csv|input.json|https://...> [options]
 *
 * Options:
 *   --out <path>       output file (default src/lego/palette.data.json)
 *   --id <id>          palette id written into the file (default builtin-v1)
 *   --source <text>    provenance source description
 *   --verified         mark the data as checked against a real catalog
 *   --default-tier <t> availability tier for rows that do not specify one
 *
 * This is the escape hatch, not the main road. The shipped palette is built by
 * `npm run palette:build` from the Rebrickable catalog extract, which carries
 * real per-shape availability and element IDs. Use this script instead when the
 * data is coming from somewhere else — a BrickLink export, a hand-kept sheet —
 * and note that without a `shapes` column it falls back to the coarse tier
 * estimate in palette-source.ts, which the Rebrickable path does not need.
 *
 * Parsing lives in palette-source.ts; this file is only the CLI shell.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePaletteFile } from '../src/lego/palette';
import { parseInput, type BuildOptions } from './palette-source';

async function readSource(location: string): Promise<string> {
  if (/^https?:\/\//.test(location)) {
    const response = await fetch(location);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }
  return readFileSync(resolve(location), 'utf8');
}

const USAGE =
  'usage: npm run palette:import -- <input.csv|input.json|url> [--out <path>]\n' +
  '                               [--id <id>] [--source <text>] [--verified]\n' +
  '                               [--default-tier full|broad|common|limited]';

export async function main(argv: readonly string[]): Promise<number> {
  // Under vite-node the script path is already stripped; under plain node it
  // is not, and a literal `--` may separate npm's args from ours.
  const dashdash = argv.indexOf('--');
  const args = dashdash === -1 ? [...argv] : argv.slice(dashdash + 1);

  const positional: string[] = [];
  const options: BuildOptions = {};
  let out = 'src/lego/palette.data.json';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    // A flag at the end of the line with no value is a typo, not a request to
    // use the default — say so rather than silently carrying on.
    const value = (): string => {
      const v = args[++i];
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`Option ${arg} needs a value`);
      }
      return v;
    };

    switch (arg) {
      case '--out':
        out = value();
        break;
      case '--id':
        options.id = value();
        break;
      case '--source':
        options.source = value();
        break;
      case '--default-tier':
        options.defaultTier = value();
        break;
      case '--verified':
        options.verified = true;
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
        positional.push(arg);
    }
  }

  const input = positional[0];
  if (!input) {
    console.error(USAGE);
    return 1;
  }

  const file = parseInput(await readSource(input), options);
  const { errors, warnings } = validatePaletteFile(file);

  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length > 0) {
    console.error(`Refusing to write ${out} — ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }

  writeFileSync(resolve(out), `${JSON.stringify(file, null, 2)}\n`);
  console.log(`Wrote ${file.colors.length} colors to ${out}`);
  if (!file.provenance.verified) {
    console.log('Marked unverified — pass --verified once the data is checked.');
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  return 1;
});
