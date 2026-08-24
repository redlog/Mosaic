/**
 * Rebuild `src/lego/palette.data.json` from the checked-in Rebrickable extract.
 *
 *   npm run palette:build
 *
 * Options:
 *   --data <dir>   catalog extract directory (default data/rebrickable)
 *   --out <path>   output file (default src/lego/palette.data.json)
 *   --bricklink <path>  name -> BrickLink ID table
 *                       (default data/bricklink-color-ids.csv)
 *   --retrieved <date>  date the extract was downloaded, for provenance
 *   --check        report what would change without writing
 *
 * Takes no input path because the input is in the repository: see
 * data/rebrickable/README.md. The joining logic lives in rebrickable.ts; this
 * file is only the CLI shell.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePaletteFile } from '../src/lego/palette';
import { buildPalette, type RebrickableSources } from './rebrickable';

const USAGE =
  'usage: npm run palette:build -- [--data data/rebrickable] [--out <path>]\n' +
  '                               [--bricklink <path>] [--retrieved <date>] [--check]';

export async function main(argv: readonly string[]): Promise<number> {
  // Under vite-node the script path is already stripped; under plain node it
  // is not, and a literal `--` may separate npm's args from ours.
  const dashdash = argv.indexOf('--');
  const args = dashdash === -1 ? [...argv] : argv.slice(dashdash + 1);

  let dataDir = 'data/rebrickable';
  let out = 'src/lego/palette.data.json';
  let bricklinkPath = 'data/bricklink-color-ids.csv';
  let retrieved: string | undefined;
  let check = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const value = (): string => {
      const v = args[++i];
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`Option ${arg} needs a value`);
      }
      return v;
    };

    switch (arg) {
      case '--data':
        dataDir = value();
        break;
      case '--out':
        out = value();
        break;
      case '--bricklink':
        bricklinkPath = value();
        break;
      case '--retrieved':
        retrieved = value();
        break;
      case '--check':
        check = true;
        break;
      case '--help':
      case '-h':
        console.log(USAGE);
        return 0;
      default:
        console.error(`Unknown argument ${arg}\n${USAGE}`);
        return 1;
    }
  }

  const read = (name: string): string => readFileSync(resolve(dataDir, name), 'utf8');
  const sources: RebrickableSources = {
    colors: read('colors.csv'),
    parts: read('parts.csv'),
    elements: read('elements.csv'),
  };
  const blFile = resolve(bricklinkPath);
  if (existsSync(blFile)) {
    sources.bricklink = readFileSync(blFile, 'utf8');
  } else {
    console.warn(`warning: ${bricklinkPath} not found — every BrickLink ID will be null`);
  }

  const { file, report } = buildPalette(
    sources,
    retrieved === undefined ? {} : { retrieved }
  );
  const { errors, warnings } = validatePaletteFile(file);

  // Colors with no BrickLink ID are already reported in aggregate below; the
  // per-color warnings would bury the summary under 50 identical lines.
  for (const w of warnings.filter((w) => !w.includes('BrickLink'))) {
    console.warn(`warning: ${w}`);
  }
  if (errors.length > 0) {
    console.error(`Refusing to write ${out} — ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }

  const text = `${JSON.stringify(file, null, 2)}\n`;
  const outPath = resolve(out);
  const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;

  console.log(
    `${report.colors} colors, ${report.pairs} (color, brick) pairs, ` +
      `all with element IDs (${report.supersededElements} superseded IDs dropped)`
  );
  console.log(
    `Skipped ${report.skippedColors} catalog colors with no element in any of ` +
      `the ${sources.parts.trim().split('\n').length - 1} brick shapes`
  );
  if (report.missingBricklinkIds.length > 0) {
    console.log(
      `No BrickLink ID for ${report.missingBricklinkIds.length} colors: ` +
        report.missingBricklinkIds.join(', ')
    );
  }

  if (check) {
    if (existing === text) {
      console.log(`${out} is up to date.`);
      return 0;
    }
    console.error(`${out} is stale — run \`npm run palette:build\`.`);
    return 1;
  }

  writeFileSync(outPath, text);
  console.log(existing === text ? `${out} unchanged.` : `Wrote ${out}.`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  return 1;
});
