# Implementation Plan

Companion to [DESIGN.md](./DESIGN.md). Section references below (§n) point there.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done

---

## How to resume this project cold

1. Read `DESIGN.md` §2 (geometry) and §7 (tiling) — those two sections carry the
   non-obvious decisions. Everything else is conventional.
2. Find the first unchecked phase below. Phases are ordered by dependency; within a
   phase, tasks are mostly parallel.
3. `npm install && npm run dev` for the app, `npm test` for the algorithm suite.
4. The pure domain logic lives in `src/lego/` and imports nothing from React. If a change
   needs the DOM, it probably belongs in `src/components/` instead.

**Current status:** design complete, no code written. Start at Phase 0.

---

## Phase 0 — Repository and tooling

Nothing else can be verified until the test runner works, so this comes first.

- [ ] `npm create vite@latest` — React + TypeScript template
- [ ] `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`
- [ ] Vitest configured and running; one trivial passing test to prove the harness
- [ ] ESLint + Prettier, `npm run lint` / `npm run format`
- [ ] `.gitignore` (node_modules, dist, coverage, .DS_Store)
- [ ] npm scripts: `dev`, `build`, `preview`, `test`, `test:watch`, `lint`, `format`
- [ ] `README.md` — what it is, how to run it, link to DESIGN.md
- [ ] Confirm `npm run build` produces a working static bundle

**Done when:** `npm run dev`, `npm test`, and `npm run build` all succeed on a clean clone.

---

## Phase 1 — Domain core

Pure, dependency-free, fully tested. No UI in this phase at all.

### 1.1 Constants and types
- [ ] `src/lego/constants.ts` — `STUD_PITCH_MM`, `BRICK_HEIGHT_MM`, `PLATE_HEIGHT_MM`, `MM_PER_INCH`
- [ ] `cellSize(orientation)` → `{ w, h }` in mm
- [ ] `finishedSize(cols, rows, orientation)` → mm, inches, cm
- [ ] `src/lego/types.ts` — all types from §4
- [ ] Tests: 48×48 pips-out = 15.118″; 48 courses pips-up = 18.142″

### 1.2 Color math — `src/lego/color.ts`
- [ ] `srgbToLinear` / `linearToSrgb` (piecewise IEC 61966-2-1, **not** `pow(c, 2.2)`)
- [ ] `linearRgbToXyz`, `xyzToLab` (D65)
- [ ] `rgbToLab` convenience wrapper
- [ ] `deltaE2000(lab1, lab2)`
- [ ] `hexToRgb` / `rgbToHex`
- [ ] `darkenLab(color, amount)` — used by the renderer for strokes and seams
- [ ] Tests: round-trips; known Lab values; **ΔE2000 vs the Sharma/Wu/Dalal 34-pair
      reference dataset** — do not skip this, a subtly wrong CIEDE2000 fails silently

### 1.3 Parts catalog — `src/lego/parts.ts`
- [ ] Shape table with design IDs (§7.1): 3005, 3004, 3622, 3010, 3009, 3008,
      3003, 3002, 3001, 2456, 3007, plus 6111, 6112, 2465, 3006 as uncommon
- [ ] `area(shape)`, `orientationsOf(shape)`, `wallInventory` (1×N only)
- [ ] `DEFAULT_FLAT_INVENTORY`, `DEFAULT_WALL_INVENTORY`
- [ ] Tests: no duplicate design IDs; wall inventory is entirely `h === 1`

### 1.4 Palette — `src/lego/palette.ts` + `palette.data.json`
- [ ] `scripts/build-palette.ts` — fetch from Rebrickable/BrickLink, emit JSON
- [ ] Run it; commit the generated `palette.data.json`
- [ ] Fallback checked-in table if the fetch is unavailable
- [ ] Per-color `shapes` availability array (§5.2) — the part that makes output buildable
- [ ] `loadPalette(overrides)` — parses, precomputes Lab, validates
- [ ] `enabledColors(palette, keys)`, `legalShapes(color, inventory, strict)`
- [ ] Tests: structural validation only (valid hex, numeric `blColorId`, non-empty
      `shapes`, every design ID exists in the catalog) — **not** assertions on specific
      hex values, which are hand-correctable data

> The generated palette's hex values and BrickLink color IDs are unverified against
> current production. Flag this in the README and keep the JSON hand-editable.

### 1.5 Seeded RNG — `src/lego/rng.ts`
- [ ] `mulberry32(seed)` → `{ next(), int(n), bool(), shuffle(arr) }`
- [ ] Tests: same seed → same sequence; distribution is not obviously broken

**Done when:** `src/lego/` has no React import and the whole suite passes.

---

## Phase 2 — Image pipeline

### 2.1 Decode
- [ ] `decodeImage(file)` via `createImageBitmap(file, { imageOrientation: 'from-image' })`
- [ ] Reject non-PNG/JPEG with a typed error
- [ ] Warn above 40 MP, offer downscale
- [ ] Composite transparency over a configurable background

### 2.2 Framing — `src/lego/frame.ts`
- [ ] Normalized crop rect (0..1), clamped to bounds
- [ ] `cropAspectFor(cols, rows, orientation)` — must use `cellH`, not 1:1 (§2.4a)
- [ ] Rotate 90° / flip H / flip V
- [ ] **Linear-light box downsample** to `cols × rows` (§6.2)
- [ ] Two-tier cost path: ≤ 8 MP full JS; > 8 MP integer canvas pre-downscale first
- [ ] Tests: solid color → uniform cells; 50/50 black/white → linear 0.5 ≈ sRGB 188
      (the gamma regression test); pips-up sampling not vertically squashed

### 2.3 Adjustments — `src/lego/adjust.ts`
- [ ] Brightness, contrast, saturation in linear light, −100..+100
- [ ] Saturation via luma-preserving interpolation (Rec. 709)
- [ ] Tests: identity at 0; monotonic; no channel overflow

### 2.4 Quantization — `src/lego/quantize.ts`
- [ ] Nearest enabled color by ΔE2000, cell Lab computed once
- [ ] Serpentine Floyd–Steinberg, error diffused in linear light, 0–100% strength
- [ ] Optional `maxColors` — greedy selection of the N best palette colors
- [ ] Tests: monochrome → one color; strength 0 identical to off; disabled colors never
      appear

**Done when:** a fixture image can be turned into a `Grid` in a Node test, no browser.

---

## Phase 3 — Tiling

The core value of the app. Both tilers share `score.ts`.

### 3.1 Shared scoring — `src/lego/score.ts`
- [ ] Owner map (`Int32Array`, placement index per cell)
- [ ] 4-corner junction counter (§7.1)
- [ ] `score(placements, owner, weights)` = `W_pieces·pieces + W_ones·ones + W_seam·seams`
- [ ] `validateTiling(tiling, grid, inventory, strict)` — the six invariants from §7.4,
      reused by every tiler test

### 3.2 Pips-out tiler — `src/lego/tile-flat.ts`
- [ ] Randomized greedy: largest area first, ties shuffled per trial
- [ ] Both rotations of each non-square shape
- [ ] Randomized raster origin and row/column-major alternation per trial
- [ ] Strict-availability check at placement time
- [ ] 1×1 fill for the remainder
- [ ] Restart loop with time budget (default 200 trials / 1.5 s), keep best by score
- [ ] Progress callback between trials
- [ ] Tests: all six invariants; solid 8×8 of an available color → exactly 8 pieces;
      determinism under a fixed seed

### 3.3 Pips-up tiler — `src/lego/tile-wall.ts`
- [ ] Maximal same-color run extraction per course
- [ ] Coin-change DP with seam penalty folded into the state (§7.2)
- [ ] Bottom-up course order, matching build order
- [ ] Weighted lookback over the previous K courses, default `[1.0, 0.4]`
- [ ] Legal-length filtering per color under strict availability
- [ ] Tests: all six invariants (including `h === 1` everywhere); run of 5 → 2 pieces
      (3+2); run of 7 → 2 pieces (4+3); solid rectangle → zero aligned seams

### 3.4 Dispatch
- [ ] `tile(grid, orientation, settings)` routes to the correct tiler
- [ ] Emits `TilingStats` including elapsed time and trials actually run

**Done when:** both tilers pass `validateTiling` on a corpus of random and pathological
grids (single color, checkerboard, thin stripes, one-cell islands).

---

## Phase 4 — Parts list and exports

- [ ] `src/lego/bom.ts` — group placements by `(designId, colorKey)`, sort by color then
      descending size; totals for pieces, distinct SKUs, distinct colors
- [ ] `src/lego/export-csv.ts` — RFC 4180 quoting, header row per §11.1
- [ ] `src/lego/export-bricklink.ts` — Wanted List XML per §11.2, XML-escaped
- [ ] Exclude colors lacking a numeric `blColorId` from XML; return them as warnings
      rather than guessing an id
- [ ] Blob download helper
- [ ] Tests: BOM quantities sum to `placements.length`; CSV re-parses to the same rows;
      XML parses via `DOMParser` with no error node; a color missing `blColorId`
      produces a warning and no `<ITEM>`

---

## Phase 5 — Rendering

- [ ] `src/lego/render.ts` — `render(tiling, palette, opts) → canvas`
- [ ] Cell pixel size honors the 5:6 ratio in pips-up
- [ ] Pips-out build view: rounded brick bodies, stud circles with highlight/shadow arcs
- [ ] Pips-up build view: flat faces, top highlight, bottom shadow, vertical seam lines
- [ ] Clean view for both: flat fill, no seams, no studs
- [ ] Padding, background, and 1× / 2× / 4× scale
- [ ] `toBlob('image/png')` export
- [ ] Tests: output canvas dimensions are exact for both orientations and all scales;
      a solid single-color mosaic renders that color at sampled interior points

---

## Phase 6 — Application UI

### 6.1 Shell and state
- [ ] `useMosaicStore` — one reducer over the settings tree from §10
- [ ] Stage memoization so a tiler-weight change does not re-decode the image (§6)
- [ ] Three-column layout, collapsing to tabs below 900px
- [ ] Dark mode via `prefers-color-scheme`

### 6.2 Panels
- [ ] `SourcePanel` — drop zone, file picker, thumbnail, rotate/flip
- [ ] `CropOverlay` — drag to move, corner handles to resize, scroll to zoom,
      aspect locked to the live mosaic aspect; Fit / Center / Reset
- [ ] `MosaicSettings` — orientation radio cards with diagrams, dimensions,
      link-to-aspect toggle, live size readout (in + cm + studs + baseplate count)
- [ ] `AdjustPanel` — brightness/contrast/saturation, dither control showing the
      resulting 1×1 count next to it
- [ ] `PalettePanel` — swatch list with usage counts, bulk actions, max-colors,
      strict-availability toggle
- [ ] `AlgorithmPanel` — inventory checkboxes, collapsed advanced weights, restarts,
      stagger depth, seed + randomize, rebuild button, auto-rebuild toggle
- [ ] `PreviewCanvas` — zoom, pan, Build/Clean/Source toggle, hover readout,
      cross-fade compare against the cropped source
- [ ] `StatsCard` — finished size, piece count, distinct parts and colors,
      1×1 count and percentage
- [ ] `PartsList` — grouped by color, collapsible, with swatches
- [ ] `ExportPanel` — PNG scale selector with pixel dimensions, CSV, XML, save, load

### 6.3 Accessibility
- [ ] Labels associated with every control; full keyboard reachability
- [ ] Color names always present as text, never color alone
- [ ] `aria-label` on the preview summarizing the current result
- [ ] Polite live region for build completion and warnings

---

## Phase 7 — Worker and performance

- [ ] `src/worker/mosaic.worker.ts` hosting quantize + tile
- [ ] Message protocol with a `generation` counter; stale results discarded (§12)
- [ ] Typed arrays transferred, not copied
- [ ] Progress events driving a real progress bar
- [ ] Auto-rebuild below 96×96; manual rebuild above
- [ ] Warning above 256 per dimension; hard cap at 400
- [ ] Benchmark 64², 128², 256² and record the numbers in the README

---

## Phase 8 — Project save and load

- [ ] `src/lego/project.ts` — serialize the full state tree from §10
- [ ] RLE encode/decode for the grid (`rle-v1`)
- [ ] Embed source as a data URL, with a *Settings only* save option
- [ ] Load: validate `format` and `version`, run migrations, reject unknown versions
      with a clear message
- [ ] Recompute the tiling on load rather than storing it
- [ ] Settings-only projects: render and export normally, disable re-crop and
      re-quantize with a visible explanation
- [ ] Tests: save → load round-trips to identical state; RLE round-trips on random
      grids; version 0 and version 99 both rejected cleanly

---

## Phase 9 — Polish and documentation

- [ ] Every edge case in §14 handled and manually verified
- [ ] Empty state: a sample image and a one-click demo project
- [ ] Loading and error states on every async path
- [ ] README: screenshots, geometry explanation, palette accuracy caveat, benchmarks
- [ ] Wall stability notes (§7.3) surfaced in the UI for pips-up, not just in the docs
- [ ] Cross-browser check: Chrome, Firefox, Safari
- [ ] Mobile layout pass on a real device
- [ ] Deploy the static build

---

## Phase 10 — Stretch

From DESIGN.md §16, in rough value-per-effort order:

- [ ] Build guide export (per-course / per-region placement instructions)
- [ ] Plates and tiles
- [ ] Undo / redo
- [ ] Per-part cost weighting in the objective
- [ ] Region-locked colors
- [ ] Multi-baseplate segmentation with per-plate parts lists
- [ ] Second-layer backing for tall pips-up walls
- [ ] CLI over `src/lego/`

---

## Milestones

| Milestone | Phases | Definition |
|---|---|---|
| **M1 — Algorithms proven** | 0–4 | An image becomes a validated tiling and a parts list, entirely in Node tests. No UI. |
| **M2 — End to end** | 5–6 | Upload a photo in a browser, see the mosaic, download the PNG and the parts list. |
| **M3 — Complete v1** | 7–9 | Responsive under load, projects save and load, edge cases handled, deployed. |

M1 is the risky part and it is the part that can be verified without a browser, which is
why it comes first. M2 and M3 are conventional application work.
