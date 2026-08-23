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

![The app with the bundled sample photo loaded](docs/screenshots/app.png)

**Complete.** Drop in a photo — or press **Try a sample photo** — frame it, choose an
orientation and size, and get a rendered brick preview, a parts list and downloadable
exports, with the heavy work in a Web Worker and projects that save and reopen.

Two things are prepared rather than finished, and are marked as such in
[TODO.md](./TODO.md): Firefox and Safari are untested (only Chromium was available
here), and the GitHub Pages workflow is committed but publishing needs Pages switched on
for the repository.

```bash
npm install && npm run dev
```

### Performance

Measured on the reference machine, strict availability on, 200 restarts:

| Grid | Orientation | Frame | Quantize + tile | Pieces | vs all-1×1 |
| ---- | ----------- | ----- | --------------- | ------ | ---------- |
| 64²  | pips-out    | 28 ms | 310 ms          | 524    | 7.8×       |
| 64²  | pips-up     | 33 ms | 10 ms           | 904    | 4.5×       |
| 128² | pips-out    | 43 ms | 984 ms          | 1,956  | 8.4×       |
| 128² | pips-up     | 26 ms | 19 ms           | 3,380  | 4.8×       |
| 256² | pips-out    | 36 ms | 1,523 ms        | 7,474  | 8.8×       |
| 256² | pips-up     | 32 ms | 22 ms           | 13,059 | 5.0×       |

Framing is flat regardless of grid size — it is bounded by the source image. The wall
tiler finishes in milliseconds because its DP is exact and runs once; the flat tiler
spends its budget on randomized restarts, and at 256² the 1.5 s budget cuts it to 75 of
the 200 requested. All of it runs in a worker, so the interface stays responsive: a
click during a 160×160 tile completes in ~150 ms.

### Projects

A project is one JSON file. It always stores the quantized grid — run-length encoded, so
a 256² mosaic is 353 runs and 2.7 KB — and optionally embeds the source photo. With the
photo it reopens fully editable (~47 KB for a 900×700 JPEG); without it (~10 KB) the
mosaic still renders, re-tiles and exports, but the crop and colors are fixed.

The tiling itself is never stored: it is recomputed from the grid, the settings and the
seed, so a saved file cannot disagree with itself.

- [DESIGN.md](./DESIGN.md) — full design: geometry, algorithms, data model, UI, formats
- [TODO.md](./TODO.md) — phased implementation plan

### The two orientations

These are not two aspect ratios — they are two different physical builds, and they need
two different tiling algorithms.

|                | Pips out                              | Pips up                                |
| -------------- | ------------------------------------- | -------------------------------------- |
| What you see   | studs facing you                      | smooth brick sides, studs hidden       |
| Construction   | laid flat on a baseplate              | stacked wall, one course per row       |
| Cell           | 8.0 × 8.0 mm — square                 | 8.0 × 9.6 mm — 5:6, taller than wide   |
| Bricks         | any rectangle, either rotation        | 1×N only; nothing spans two courses    |
| Seams          | cosmetic — the baseplate carries load | structural — a stacked seam is a crack |
| 48×48 finishes | 15.1″ × 15.1″                         | 15.1″ × 18.1″                          |

Two consequences fall out of that table and are easy to get wrong. Sampling has to be
**anisotropic** in pips-up — each cell covers a source region 1.2× taller than it is
wide, so a square sampling grid squashes the picture. And the wall tiler staggers its
seams into a running bond, because a seam repeating up the courses is a fracture line in
a wall one stud deep.

<img src="docs/screenshots/wall.png" alt="A pips-up wall showing running bond" width="360">

Close up, in pips-out, you can see the merging the tiler does — large flat regions
become 2×4s and 2×8s rather than hundreds of 1×1s:

<img src="docs/screenshots/bricks-closeup.png" alt="Close-up of rendered bricks and studs" width="520">

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

### Browser support

Developed and verified in Chromium. The app uses `createImageBitmap`, `OffscreenCanvas`,
module Web Workers and `CanvasRenderingContext2D.roundRect`; each has a fallback —
an `<img>` decode path, a plain `<canvas>`, a synchronous in-thread pipeline, and square
brick corners respectively — so an older engine degrades rather than breaking.

**Firefox and Safari are untested.** Only Chromium was available in the environment this
was built in, so those fallbacks are written against documented behaviour, not observed
behaviour. Worth an hour on real browsers before calling it done.

### Layout

`src/lego/` holds the domain logic: geometry, color math, framing, quantization, the two
tilers, the parts list, and the exports. It is pure TypeScript with no React and no DOM
access, so it is unit-testable in Node and reusable from a CLI later.

`src/browser/` holds the platform adapters — decoding a `File` into pixels, handing a
Blob to the user's disk. These are the only modules that touch the DOM outside the UI
itself; everything else that does belongs in `src/components/`.

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
