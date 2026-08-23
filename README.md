# Mosaic

A single-page web app that turns a photo into a buildable LEGO brick mosaic — with a real
parts list you can order and a rendered preview of the finished build.

Everything runs in the browser. There is no server and no account; a project is saved and
restored as a single JSON file.

## What it does

- Upload a PNG or JPEG and frame it with a draggable crop box.
- Choose **pips out** (studs facing you, square cells, laid flat on a baseplate) or
  **pips up** (studs facing the ceiling, viewed edge-on as a stacked wall, 5:6 cells).
- Set the mosaic size in bricks; see the finished size in inches.
- The image is downsampled, mapped to real LEGO colors, and — importantly — merged into
  the **largest legal bricks available**, so a flat region becomes a handful of 2×8s
  rather than hundreds of 1×1s. Cheaper, faster to build, stronger.
- Export the preview PNG, a parts-list CSV, and a BrickLink Wanted List XML.

## Status

Phases 0–2 complete — toolchain, domain core (geometry, color science, parts catalog,
palette, seeded RNG), and the image pipeline (crop, orient, linear-light downsample,
adjustments, quantization). An image becomes a color-mapped grid entirely in Node
tests. No tiling or UI yet.

- [DESIGN.md](./DESIGN.md) — full design: geometry, algorithms, data model, UI, formats
- [TODO.md](./TODO.md) — phased implementation plan

## Getting started

```bash
npm install
npm run dev        # dev server
npm test           # algorithm test suite
npm run build      # static production bundle into dist/
npm run check      # typecheck + lint + format check + tests
```

| Script                | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `dev`                 | Vite dev server with HMR                             |
| `build`               | typecheck, then build the static bundle into `dist/` |
| `preview`             | serve the built bundle locally                       |
| `test` / `test:watch` | Vitest, once / in watch mode                         |
| `coverage`            | Vitest coverage over `src/lego/`                     |
| `typecheck`           | `tsc --noEmit`                                       |
| `lint` / `lint:fix`   | ESLint                                               |
| `format`              | Prettier, write in place                             |
| `check`               | everything above, for CI or a pre-push gate          |

Requires Node 20+ (developed on 22).

### Layout

`src/lego/` holds the domain logic: geometry, color math, framing, quantization, the two
tilers, the parts list, and the exports. It is pure TypeScript with no React and no DOM
access, so it is unit-testable in Node and reusable from a CLI later.

`src/image/` holds the one stage that genuinely needs the DOM — decoding a `File` into
pixels — and stays deliberately thin. Anything else that touches the DOM belongs in
`src/components/`.

## A note on the color data

**The shipped palette is unverified.** `src/lego/palette.data.json` holds 42 curated
colors compiled from reference knowledge, without access to a live catalog. Hex values
are reasonable, BrickLink color IDs are plausible but unconfirmed, and the per-shape
availability lists are a coarse four-tier estimate rather than real catalog data.

The code is built around that uncertainty rather than hiding it: the file carries a
`provenance.verified: false` flag that `loadPalette` surfaces as a warning, colors with
no BrickLink ID are omitted from the Wanted List export instead of being guessed, and
the tests validate structure only — never specific hex values — so correcting the data
never looks like a regression.

To replace it with real data:

```bash
npm run palette:build -- colors.csv --verified
```

The input may be CSV or JSON, local or a URL. Required columns are `name` and one of
`hex` / `rgb` (accepting `#RRGGBB`, `RRGGBB`, or `r,g,b`). Optional: `key`, `bl_id`,
`shapes` (space-separated design IDs), and `tier` (`full` / `broad` / `common` /
`limited`, expanded into per-shape availability). The script validates before writing
and refuses to emit a file with structural errors.
