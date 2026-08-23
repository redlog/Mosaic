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

Phase 0 complete — the toolchain is scaffolded and verified. No domain logic yet.

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

`src/lego/` holds the domain logic: geometry, color math, quantization, the two tilers,
the parts list, and the exports. It is pure TypeScript with no React and no DOM access,
so it is unit-testable in Node and reusable from a CLI later. Anything that touches the
DOM belongs in `src/components/`.

## A note on the color data

The palette ships as a plain, hand-editable JSON file. Its hex values and BrickLink
color IDs come from reference tables and are **not independently verified against current
production**, so treat the parts list as a strong starting point rather than gospel —
and correct the JSON directly if you find a wrong value.
