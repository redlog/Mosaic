# LEGO Mosaic Generator — Design Document

**Status:** design approved; Phases 0-3 complete (toolchain, domain core, image pipeline, tilers)
**Version:** 1.0 (2026-08-23)

---

## 1. Overview

A single-page web app that converts an uploaded photo into a buildable LEGO brick
mosaic. Everything runs client-side; there is no server and no persistent storage.
Work is preserved by downloading and re-uploading a JSON project file.

### 1.1 What it does

1. User uploads a PNG or JPEG.
2. User chooses an orientation (**pips out** or **pips up**) and the mosaic size in bricks.
3. User frames the image with a draggable crop box.
4. The app downsamples the crop to the brick grid, maps every cell to a real LEGO color,
   then merges same-colored cells into the largest legal bricks it can.
5. The app renders a preview PNG of the finished build and produces a parts list.

### 1.2 Goals

- **Buildable output.** Every part in the list is a real part that exists in that color.
- **Few, large bricks.** Large flat regions become 2×8s, not 64 separate 1×1s. This is
  cheaper, faster to build, and structurally stronger.
- **Honest physical dimensions.** Finished size in inches is computed from real LEGO
  geometry, including the non-square cell in pips-up mode.
- **Portable state.** A project is one JSON file, self-contained by default.

### 1.3 Non-goals for v1

Plates and tiles (bricks only). SNOT construction. Transparent, printed, or chrome parts.
Live price lookup. Multi-depth relief mosaics. A printed step-by-step instruction booklet.
User accounts, cloud storage, or any network call at runtime.

---

## 2. Domain model and geometry

### 2.1 The two orientations

These are not merely two aspect ratios — they are two different physical constructions,
and they require **two different tiling algorithms**.

```
PIPS OUT  (flat on a baseplate, studs facing the viewer)

        viewer
          |
          v          each cell = the top face of one stud
      ┌───┬───┬───┐  cell is 8.0mm x 8.0mm  ->  1:1, square
      │ o │ o │ o │  a 2x4 brick covers a 2x4 block of cells
      ├───┼───┼───┤  bricks tile a PLANE, any orientation
      │ o │ o │ o │  the baseplate carries all the load
      └───┴───┴───┘


PIPS UP  (stacked wall, studs facing the ceiling, viewed edge-on)

        viewer ──>   each cell = the side face of one stud-width of brick
      ┌───────────┐  cell is 8.0mm wide x 9.6mm tall  ->  5:6, tall
      │  1x4      │  a brick spans HORIZONTALLY ONLY, one course tall
      ├───┬───────┤  there is no such thing as a brick two courses tall
      │1x1│  1x3  │  the wall is one stud deep and self-supporting
      └───┴───────┘  => seam staggering is structural, not cosmetic
```

### 2.2 Constants

| Constant          | Value | Note                              |
| ----------------- | ----- | --------------------------------- |
| `STUD_PITCH_MM`   | 8.0   | center-to-center stud spacing     |
| `BRICK_HEIGHT_MM` | 9.6   | brick height, exactly 1.2 × pitch |
| `PLATE_HEIGHT_MM` | 3.2   | unused in v1, defined for future  |
| `MM_PER_INCH`     | 25.4  |                                   |

### 2.3 Cell dimensions and finished size

| Orientation | `cellW` | `cellH` | Finished width  | Finished height |
| ----------- | ------- | ------- | --------------- | --------------- |
| `pips-out`  | 8.0 mm  | 8.0 mm  | `cols × 8.0` mm | `rows × 8.0` mm |
| `pips-up`   | 8.0 mm  | 9.6 mm  | `cols × 8.0` mm | `rows × 9.6` mm |

Worked example, 48 × 48 grid:

- pips-out: 384 × 384 mm = **15.12″ × 15.12″** (square)
- pips-up: 384 × 460.8 mm = **15.12″ × 18.14″** (taller)

Depth in both cases is one brick, 9.6 mm, plus the baseplate if used.

### 2.4 Two consequences that are easy to get wrong

**(a) Sampling must be anisotropic in pips-up.** Each cell represents a source region
1.2× taller than it is wide. If you sample on a square grid the image comes out
vertically squashed. The crop rectangle's aspect ratio is therefore locked to
`cols × cellW : rows × cellH`, not to `cols : rows`.

**(b) A brick in a pips-up wall cannot span two courses.** Brick height is fixed at
9.6 mm, so the vertical extent of every visible brick face is exactly one cell.
The inventory in pips-up is 1×N only, spanning horizontally. This is why the two
modes need separate tilers rather than a shared one with a different aspect constant.

---

## 3. Technology stack

| Concern       | Choice                                            | Rationale                                          |
| ------------- | ------------------------------------------------- | -------------------------------------------------- |
| Build         | Vite 8                                            | fast dev server, static output, zero config for TS |
| Language      | TypeScript 6, `strict: true`                      | the algorithm code benefits most from types        |
| UI            | React 19 + function components                    | settings-panel state is the bulk of the UI work    |
| State         | plain `useState` / `useReducer` in one store hook | app is small; a state library is overkill          |
| Styling       | CSS Modules + CSS custom properties               | no runtime cost, easy dark mode                    |
| Heavy compute | Web Worker (`mosaic.worker.ts`)                   | quantize + tile must not block the UI              |
| Rasterization | Canvas 2D / OffscreenCanvas                       | no WebGL needed at these sizes                     |
| Tests         | Vitest 4                                          | shares Vite config, fast                           |
| Lint/format   | ESLint 10 + Prettier 3                            |                                                    |
| Deploy        | static build, GitHub Pages compatible             | no backend                                         |

**No runtime network access.** The palette is compiled into the bundle. The app works
offline once loaded.

> **Why TypeScript 6 rather than 7.** TypeScript 7 is released, but
> `typescript-eslint` declares a peer range of `>=4.8.4 <6.1.0` and will not install
> alongside it. Typed lint rules are worth more here than being on the newest compiler,
> so TypeScript is pinned to 6.0.x. Revisit once `typescript-eslint` ships TS 7 support.

### 3.0 Compiler strictness

Beyond `strict`, the project enables `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals`, and
`noUnusedParameters`.

`noUncheckedIndexedAccess` deserves a note because it cuts both ways. It is genuinely
valuable for the map- and record-shaped lookups this app is full of (`palette[key]`,
`shapesByDesignId[id]`), where a miss is a real bug. It is _noise_ in the numeric
kernels, where `grid.colors[i]` is provably in range and TypeScript still widens it to
`number | undefined`. The kernels absorb this with non-null assertions, and ESLint
allows `!` only under `src/lego/` so the escape hatch stays where the hot loops are.

### 3.1 Project structure

```
/
├─ DESIGN.md
├─ TODO.md
├─ README.md
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
└─ src/
   ├─ main.tsx
   ├─ App.tsx
   ├─ lego/                     ← pure, framework-free, fully unit tested
   │  ├─ constants.ts           geometry constants, unit conversion
   │  ├─ types.ts               shared domain types
   │  ├─ color.ts               sRGB ↔ linear ↔ XYZ ↔ Lab, ΔE2000
   │  ├─ palette.ts             palette loading, filtering, availability
   │  ├─ palette.data.json      the color table (generated, hand-correctable)
   │  ├─ parts.ts               brick shape catalog + design IDs
   │  ├─ frame.ts               crop, orient → linear-light cell averages
   │  ├─ adjust.ts              brightness / contrast / saturation
   │  ├─ quantize.ts            nearest-color mapping + dithering
   │  ├─ tile-flat.ts           pips-out tiler (randomized greedy + restarts)
   │  ├─ tile-wall.ts           pips-up tiler (per-course DP)
   │  ├─ score.ts               shared objective function, seam detection
   │  ├─ bom.ts                 placements → parts list
   │  ├─ render.ts              tiling → canvas
   │  ├─ project.ts             JSON save/load, RLE, migrations
   │  ├─ export-csv.ts
   │  ├─ export-bricklink.ts
   │  └─ rng.ts                 seeded PRNG (mulberry32)
   ├─ image/
   │  └─ decode.ts              File → pixels (the only DOM-dependent stage)
   ├─ worker/
   │  └─ mosaic.worker.ts
   ├─ state/
   │  └─ useMosaicStore.ts
   ├─ components/
   │  ├─ SourcePanel.tsx        drop zone, thumbnail, crop overlay
   │  ├─ CropOverlay.tsx        drag / resize / zoom interaction
   │  ├─ MosaicSettings.tsx     orientation, dimensions, size readout
   │  ├─ AdjustPanel.tsx        image adjustments, dithering
   │  ├─ PalettePanel.tsx       color enable/disable, max-colors
   │  ├─ AlgorithmPanel.tsx     inventory, weights, restarts, seed
   │  ├─ PreviewCanvas.tsx      zoom/pan, build vs clean view
   │  ├─ StatsCard.tsx
   │  ├─ PartsList.tsx
   │  └─ ExportPanel.tsx
   └─ styles/
```

The `src/lego/` directory is the heart of the project. Nothing in it imports React or
touches the DOM, so it is testable in isolation and reusable from a CLI later.

---

## 4. Core data types

```ts
export type Orientation = 'pips-out' | 'pips-up';

export interface BrickShape {
  designId: string; // BrickLink / LEGO part number, e.g. "3001"
  name: string; // "Brick 2 x 4"
  w: number; // studs, long axis
  h: number; // studs, short axis (always 1 for wall inventory)
}

export interface LegoColor {
  key: string; // stable slug, "dark-turquoise"
  name: string; // "Dark Turquoise"
  hex: string; // "#008F9B"
  rgb: [number, number, number];
  lab: [number, number, number]; // precomputed at load
  blColorId: number; // BrickLink color ID, required for XML export
  ldrawId?: number;
  shapes: string[]; // design IDs this color is actually produced in
}

/** Result of quantization: one palette index per cell, row-major. */
export interface Grid {
  cols: number;
  rows: number;
  colors: Int16Array; // length cols*rows; index into the active palette
}

export interface Placement {
  designId: string;
  col: number; // top-left cell
  row: number;
  w: number; // as placed, after any rotation
  h: number;
  colorIdx: number;
}

export interface Tiling {
  orientation: Orientation;
  cols: number;
  rows: number;
  placements: Placement[];
  stats: TilingStats;
}

export interface TilingStats {
  pieces: number;
  ones: number; // count of 1×1 bricks
  alignedSeams: number; // 4-corner junctions (flat) / stacked seams (wall)
  score: number;
  seed: number;
  trials: number;
  elapsedMs: number;
}

export interface BomLine {
  designId: string;
  partName: string;
  colorKey: string;
  colorName: string;
  blColorId: number;
  quantity: number;
}
```

---

## 5. Color system

### 5.1 Palette contents

A curated set of roughly 30–40 currently-produced solid colors — the balance point
between image fidelity and being able to actually buy the parts. Retired and rare
colors are excluded because a parts list you cannot fill is not a parts list.

### 5.2 Availability is per-shape, not per-color

This is the detail that separates a toy from a usable tool. **Not every color is
produced in every brick shape.** Dark Turquoise in a 1×8 brick is not a thing you can
buy. So a palette entry does not carry a single "available" flag — it carries the set
of design IDs that color is actually produced in, and the tiler consults that set on
every placement.

```json
{
  "key": "dark-turquoise",
  "name": "Dark Turquoise",
  "hex": "#008F9B",
  "blColorId": 39,
  "shapes": ["3005", "3004", "3622", "3010", "3003", "3001"]
}
```

With **strict availability** on (the default), a cell of Dark Turquoise can only be
covered by shapes in that list. The result has a slightly higher piece count and a
parts list that can be filled in one order. With it off, the tiler uses the full
inventory and the UI flags lines that may be hard to source.

### 5.3 Sourcing the data

Build-time script `scripts/build-palette.ts` fetches from a public dataset
(Rebrickable's `colors.csv` plus part/color availability, or the BrickLink color guide)
and emits `src/lego/palette.data.json`. If the fetch is unavailable the script falls
back to a checked-in table.

> **Accuracy caveat:** the fallback hex values and BrickLink color IDs are drawn from
> reference tables and are _not independently verified against current production_.
> `palette.data.json` is deliberately a plain, hand-editable file. Any value in it can
> be corrected without touching code, and the test suite validates structure (every
> color has a numeric `blColorId`, a valid hex, and a non-empty `shapes` array) rather
> than asserting specific values.

### 5.4 Color math

All in `src/lego/color.ts`, all pure functions:

- `srgbToLinear(c)` / `linearToSrgb(c)` — the piecewise IEC 61966-2-1 transfer function,
  not the `pow(c, 2.2)` approximation.
- `linearRgbToXyz` / `xyzToLab` under D65.
- `deltaE2000(lab1, lab2)` — CIEDE2000.

**Why ΔE2000 and not the simpler ΔE76.** Mosaics are full of near-neutral colors —
skin, sky, concrete, shadow. ΔE76 is a plain Euclidean distance in Lab and
systematically misjudges exactly that region, producing visible mis-picks in faces.
ΔE2000's hue-rotation and chroma-weighting terms fix it. Cost is negligible here: a
128×128 grid against 40 colors is 655k evaluations, a few tens of milliseconds.

**Correctness check:** `deltaE2000` is verified against the 34-pair reference dataset
published by Sharma, Wu & Dalal (2005) — the standard conformance test for this formula.
Getting CIEDE2000 subtly wrong is common and silent, so this test is mandatory, not optional.

---

## 6. Processing pipeline

Six stages, each a pure function, each memoized on its inputs. Adjusting a tiler weight
must not re-decode a 12-megapixel JPEG.

```
File
 │  decode                  createImageBitmap, EXIF-aware
 ▼
ImageBitmap
 │  frame(crop, cols, rows, orientation)
 ▼
Float32Array  cols*rows*3, LINEAR light
 │  adjust(brightness, contrast, saturation)
 ▼
Float32Array
 │  quantize(palette, dither)
 ▼
Grid          Int16Array of palette indices
 │  tile(inventory, weights, seed)     ← in worker
 ▼
Tiling        list of placements
 │  ├─ bom()      → parts list → CSV, BrickLink XML
 │  └─ render()   → canvas → PNG
```

### 6.1 Decode

Decoding is the only stage that needs the DOM, so it lives in `src/image/decode.ts`
rather than `src/lego/`, keeping the domain core testable in Node. It stays thin and
hands off every decision it can to a pure function — the pre-shrink factor, for
instance, comes from `pickDownscaleFactor` in `frame.ts`.

```ts
createImageBitmap(file, { imageOrientation: 'from-image' });
```

The `imageOrientation` flag is required — without it, every photo taken on a phone in
portrait comes in rotated 90°, which is the single most common "the app is broken" report
for image tools.

- Accepted: `image/png`, `image/jpeg`.
- Images over 40 MP: warn and offer to downscale before proceeding.
- Transparent PNGs and grayscale images are composited onto a configurable background
  (default white) before sampling.

### 6.2 Framing and downsampling

The crop rectangle is stored **normalized** (`x, y, w, h` in 0..1 of the source), so it
survives a change of source resolution and serializes cleanly. Its aspect ratio is locked
to `cols × cellW : rows × cellH`.

Downsampling is a **box filter in linear light**. Averaging in gamma-encoded sRGB is the
classic mistake here and makes every result muddy and dark — a 50/50 mix of black and
white must come out at linear 0.5 (sRGB ≈ 188), not sRGB 128.

Cost control, since a full JS pass over 40 MP is wasteful for a 48×48 output:

- crop area ≤ 8 MP → box-average the whole crop in JS, linear light, exact.
- crop area > 8 MP → pre-downscale by an integer factor via canvas `drawImage` to get
  under 8 MP, then do the linear box average in JS.

The pre-downscale step is itself gamma-incorrect, but applying it only to the first
integer factor and doing the rest correctly recovers nearly all of the benefit at a
fraction of the cost. Documented here so the tradeoff is deliberate rather than accidental.

### 6.3 Adjustments

Brightness, contrast, saturation, each −100..+100. These matter more than they sound:
the LEGO palette is small and highly saturated, so a flat photo maps into a narrow band
of colors and a contrast bump often improves the result more than any algorithm change.

**Applied in gamma-encoded space, not linear light** — a deliberate departure from the
rest of the pipeline. Averaging demands linear light; perceptual controls do not, and
users expect these three to behave the way every photo editor behaves. The deciding
case is the contrast pivot: perceptual mid-gray is sRGB 128, but linear 0.5 sits at
sRGB 188, nearly white. Pivoting there would drag almost the whole image down into
shadow rather than spreading it about the middle. Rec. 709 luma coefficients are
likewise defined on gamma-encoded R′G′B′, so saturation lands in the right space too.
The cell buffer is converted out of and back into linear light around these operations,
which costs two transfer-function evaluations per channel per _cell_ — negligible, since
this runs on the grid rather than on source pixels.

Brightness lifts toward white (`v + t(1−v)`) rather than adding a flat offset, so both
endpoints stay pinned and highlights do not blow out the moment the slider moves.
Contrast is a pivot scale about sRGB 0.5, range 0–2. Saturation interpolates about luma,
range 0–2. Order is brightness, contrast, saturation.

### 6.4 Quantization

For each cell, find the enabled palette color with the minimum ΔE2000. Convert each cell
to Lab once and reuse.

**Optional cap on distinct colors.** If "max colors = N" is set, greedily select the N
palette colors minimizing total ΔE over the whole downsampled image, then quantize
against only those. This is a real cost lever — sourcing 12 colors is far cheaper and
simpler than sourcing 38.

**Dithering — off by default.** Serpentine Floyd–Steinberg, error diffused in linear
light, with a 0–100% strength scale.

> Dithering works directly against the "use big bricks" goal. It deliberately breaks up
> flat regions into alternating colors, which is exactly the pattern the tiler cannot
> merge. A dithered mosaic can easily be 3–4× the piece count and almost all 1×1s. It
> stays available because at large grid sizes it genuinely improves gradients, but it
> defaults to off and the UI shows the resulting 1×1 count next to the control.

### 6.5 Tiling

Two algorithms. Details in §7.

### 6.6 Rendering

Details in §8.

---

## 7. Tiling algorithms

Shared objective, minimized in both modes:

```
score = W_pieces × pieces
      + W_ones   × (count of 1×1 bricks)
      + W_seam   × (aligned seams)
```

Defaults `W_pieces = 1.0`, `W_ones = 0.5`, all exposed as advanced sliders.

`W_seam` differs by orientation — **0.25 laid flat, 0.5 in a wall** — because the same
number means different things in the two constructions. Flat on a baseplate an aligned
seam is an appearance problem; in a one-stud-deep wall it is a fracture line.

The wall value is forced by a specific case rather than chosen by taste. A 32-wide run
has exactly one minimum-piece tiling, 8+8+8+8, so seams at columns 8, 16 and 24 are
unavoidable at four pieces and breaking the bond costs a fifth. At 0.25 those three
aligned seams price at 0.75 against the 1.0 of an extra brick, so the tiler stacks them
into a continuous crack the full height of the wall. At 0.5 the arithmetic reverses and
the bond breaks. Measured cost on a solid 32-wide wall: about 6% more pieces.

Piece count is a proxy for cost. It is not a perfect proxy — a 2×8 costs more than a
1×1 — but real per-part prices vary by color and by seller, and they are not available
offline. The BrickLink export exists precisely so that real pricing happens where the
real data is.

### 7.1 Pips-out — randomized greedy with restarts

The mosaic sits on a baseplate, which carries all the load. Structure is therefore free
and this is a pure cost-and-aesthetics problem: tile each monochrome region with as few,
as large, and as pleasingly-offset bricks as possible.

Default inventory:

| Part | Shape |     | Part | Shape |
| ---- | ----- | --- | ---- | ----- |
| 3005 | 1 × 1 |     | 3003 | 2 × 2 |
| 3004 | 1 × 2 |     | 3002 | 2 × 3 |
| 3622 | 1 × 3 |     | 3001 | 2 × 4 |
| 3010 | 1 × 4 |     | 2456 | 2 × 6 |
| 3009 | 1 × 6 |     | 3007 | 2 × 8 |
| 3008 | 1 × 8 |     |      |       |

Optional long bricks, off by default: 6111 (1×10), 6112 (1×12), 2465 (1×16), 3006 (2×10).
They are pricier per stud and thin in color coverage.

```
function tileFlat(grid, inventory, weights, seed, budgetMs):
    best = null
    for trial in 0 .. maxTrials:
        rng   = mulberry32(seed + trial)
        owner = Int32Array(cols*rows).fill(-1)
        placements = []

        # shapes largest-area first; ties broken randomly each trial
        # (2x4 and 1x8 are both area 8 — which one wins matters)
        order = shuffleTies(inventory sorted by area desc, rng)

        for shape in order:
            for (w, h) in orientationsOf(shape):        # (w,h) and (h,w) if w != h
                # randomized raster origin so trials explore different packings
                for (col, row) in rasterFrom(rng.offset(), rng.bool() ? ROW_MAJOR : COL_MAJOR):
                    if fits(owner, grid, col, row, w, h):     # all free AND all one color
                        if strictAvailability and shape not in colorOf(col,row).shapes:
                            continue
                        place(shape, col, row, w, h)

        fillRemainderWith1x1(owner, placements)
        s = score(placements, owner, weights)
        if best == null or s < best.score: best = { placements, score: s }

        if elapsed() > budgetMs: break
    return best
```

Exact minimum tiling of an arbitrary polyomino by a restricted rectangle set is NP-hard,
so this is deliberately a heuristic. Randomized-restart greedy on an inventory this small
lands within a few percent of optimal in practice, and it is fast enough to run hundreds
of trials inside a time budget.

**Measured on a 48×48 test scene** (sky gradient, sun, building, ground), strict
availability on, 200 restarts:

| Orientation | Pieces | vs all-1×1             | 1×1s | Aligned seams | Time   |
| ----------- | ------ | ---------------------- | ---- | ------------- | ------ |
| pips-out    | 330    | 2,304 → **7.0× fewer** | 39   | 178           | 430 ms |
| pips-up     | 542    | 2,304 → **4.3× fewer** | 42   | 73            | 4 ms   |

The wall uses more pieces because it is restricted to 1×N, and finishes in single-digit
milliseconds because its DP is exact and runs once rather than two hundred times.

**Restarts:** default 200, bounded by a 1.5 s budget (whichever comes first), so large
grids degrade to fewer trials rather than to a frozen tab. Seed is stored in the project
file, so a given project always reproduces the identical tiling.

**Aligned-seam detection (the 4-corner junction).** For every interior lattice point,
look at the four cells meeting there. If all four belong to four _different_ bricks, the
bricks form a `+` junction — weaker interlock and visually noisy. Counting them is one
O(cols × rows) pass over the owner map.

```
for y in 1..rows-1:
  for x in 1..cols-1:
    a = owner[y-1][x-1]; b = owner[y-1][x]
    c = owner[y][x-1];   d = owner[y][x]
    if a,b,c,d all distinct: junctions++
```

### 7.2 Pips-up — per-course dynamic programming (exactly solvable)

Each image row is one **course** of the wall. A brick spans horizontally within a single
course. Inventory is 1×N only: `L ∈ {1, 2, 3, 4, 6, 8}` (optionally 10, 12, 16).

Within a course, a maximal run of identical color spanning columns `[a, b)` must be
partitioned into available lengths. That is coin-change — a trivial DP with an exact
optimum. The useful part is that the DP state extends to carry the seam penalty at no
extra cost, so **running bond falls out of the optimization automatically** rather than
being bolted on as a post-pass.

```
# process courses bottom-up, matching real build order
for row in rows-1 .. 0:
    for each maximal same-color run [a, b) in row:
        len = b - a
        dp[0] = 0
        for i in 1 .. len:
            dp[i] = min over L in lengths where L <= i and legal(L, color):
                        dp[i-L]
                      + W_pieces
                      + (L == 1 ? W_ones : 0)
                      + (i < len ? W_seam * seamPenalty(a + i) : 0)
        emit bricks by walking the choice array back from dp[len]
    record this course's seam column set
```

A seam at `a + i` is only penalized when `i < len`: the boundaries at `a` and `b` are
forced by the color change and are unavoidable, so charging for them would just add a
constant.

**Lookback depth.** Penalizing against only the previous course still permits a seam to
reappear every other course, which is a real fracture line in a one-stud-deep wall. So
`seamPenalty(col)` is a weighted sum over the previous _K_ courses, default `K = 2` with
weights `[1.0, 0.4]`. The DP is unchanged — only the penalty lookup gets deeper.

Complexity is `O(rows × cols × |lengths| )`, effectively instant. Each course is exactly
optimal given the courses below it; the greedy sweep across courses is not globally
optimal, but it is the standard masonry approach and produces excellent bond patterns.

### 7.3 Wall stability notes (documented, not enforced in v1)

A one-stud-deep wall of 1×N bricks is a real structure with real limits. The generated
build guide notes will state:

- Build on a foundation row of the longest available bricks, ideally on plates or a
  baseplate.
- Consider a frame, or a second layer behind the visible one, above roughly 40 courses.
- The stagger penalty prevents the worst failure mode (a continuous vertical seam), but
  it cannot make a tall freestanding wall rigid on its own.

### 7.4 Tiler invariants (asserted in tests, both modes)

1. Every cell is covered by exactly one placement — no gaps, no overlaps.
2. Every placement is monochrome in the source grid.
3. Every placement's shape is in the active inventory.
4. Under strict availability, every placement's shape is legal for its color.
5. In `pips-up`, every placement has `h === 1`.
6. Output is deterministic for a given `(grid, inventory, weights, seed)`.

---

## 8. Rendering

`render(tiling, palette, opts) → HTMLCanvasElement`

```ts
interface RenderOptions {
  pxPerStud: number; // default 24
  mode: 'build' | 'clean';
  background: string;
  padding: number;
  scale: 1 | 2 | 4;
}
```

Cell pixel size is `pxPerStud × pxPerStud` in pips-out, and
`pxPerStud × pxPerStud × 1.2` in pips-up — the same 5:6 ratio as the real bricks, so the
preview is dimensionally honest.

**Build view** shows construction. **Clean view** shows the result from across the room.
Both are exportable; they answer different questions ("how do I build this?" vs "do I
like it?").

### 8.1 Pips-out

- Brick body: rounded rectangle, filled with the color, stroked 1px in the same color
  darkened ~12% in Lab lightness.
- Studs: one circle per stud position at `r = 0.30 × pxPerStud`, filled with the body
  color, plus a top-left highlight arc (white, 18% alpha) and a bottom-right shadow arc
  (black, 15% alpha), and a thin ring at the stud edge.
- Clean view: flat fill per cell, no strokes, no studs.

### 8.2 Pips-up

Viewed dead-on, a stud-up wall shows no studs at all — that is exactly why this
orientation reads as smooth. The render shows flat brick faces and the seams between them.

- Brick face: flat fill; 1px highlight along the top edge (white, 10%), 1px shadow along
  the bottom edge (black, 12%).
- Vertical seams between bricks within a course: 1px line, color darkened 15%.
- Clean view: flat fill, no lines.

### 8.3 Preview interaction

The on-screen preview is the same renderer at a screen-fit `pxPerStud`, with zoom
(scroll / pinch) and pan (drag). Hovering a cell shows `col, row` and the color name.
A "compare" control cross-fades against the cropped source image, which is the fastest
way to judge whether the quantization did the image justice.

---

## 9. User interface

### 9.1 Layout

Desktop, ≥ 1100px — three columns:

```
┌──────────────┬──────────────────────────────┬──────────────┐
│ SOURCE       │                              │ STATS        │
│  drop zone   │                              │  15.1 x 15.1 │
│  thumbnail   │                              │  1,284 parts │
│  + crop box  │        PREVIEW CANVAS        │  22 colors   │
│              │                              │              │
│ MOSAIC       │      [Build] [Clean] [Src]   │ PARTS LIST   │
│  orientation │        zoom / pan            │  ▸ White  312│
│  cols x rows │                              │  ▸ Red    128│
│  size readout│                              │  ▸ Black   96│
│ ADJUST       │                              │      ...     │
│ PALETTE      │                              │              │
│ ALGORITHM    │                              │ EXPORT       │
│              │                              │  PNG CSV XML │
└──────────────┴──────────────────────────────┴──────────────┘
   320px               flexible                    300px
```

Below 900px the layout collapses to a single column with a tab bar:
**Source · Settings · Preview · Parts**.

### 9.2 Panels

**Source**

- Drop zone and file picker (`image/png`, `image/jpeg`).
- Thumbnail with a draggable, resizable crop rectangle. Drag to move, corner handles to
  resize, scroll to zoom. Aspect locked to the mosaic aspect; the lock updates live when
  the mosaic dimensions change.
- Buttons: _Fit whole image_, _Center_, _Reset_.
- Rotate 90° CW / CCW, flip horizontal / vertical.

**Mosaic**

- Orientation: two radio cards, each with the small diagram from §2.1 and its cell ratio.
- Width in bricks, height in bricks — number input plus slider, range 8–256.
- _Link to image aspect_ toggle: when on, editing width recomputes height from the crop
  aspect, correctly accounting for the 5:6 cell in pips-up.
- Live readout: finished size in inches **and** cm, total studs, and in pips-out the
  number of 48×48 baseplates required.

**Adjust**

- Brightness, contrast, saturation sliders, with reset.
- Dither: _Off_ / _Floyd–Steinberg_ with a 0–100% strength slider. Shows the resulting
  1×1 count beside it so the cost of dithering is visible at the moment of choosing it.

**Palette**

- Scrollable list: swatch, name, enable checkbox, and a live usage count.
- Bulk actions: all, none, _keep only colors used in the current result_.
- _Max distinct colors_ (default off).
- _Strict availability_ toggle, on by default.

**Algorithm**

- Brick inventory checkboxes, grouped 1×N and 2×N, with the long bricks in a
  collapsed "uncommon" group.
- Collapsed advanced section: the three objective weights, restart count, stagger
  lookback depth, and the seed with a _randomize_ button.
- _Rebuild_ button, plus an auto-rebuild toggle. Quantization is always live and
  debounced 300 ms; tiling auto-runs only below 96×96 to avoid constant recomputation.

**Export**

- PNG (scale 1× / 2× / 4×, with the resulting pixel dimensions shown), CSV,
  BrickLink XML, Save Project, Load Project.

### 9.3 Accessibility

Every control keyboard reachable with an associated label. Color entries always carry
their name as text, never color alone. The preview canvas carries an `aria-label`
summarizing dimensions, piece count, and color count. Dark mode via
`prefers-color-scheme`. All actionable state changes announced through a polite live region.

---

## 10. Project file format

A project is one JSON file. Self-contained by default.

```jsonc
{
  "format": "lego-mosaic-project",
  "version": 1,
  "createdAt": "2026-08-23T18:00:00.000Z",
  "app": { "version": "0.1.0" },

  "source": {
    "name": "portrait.jpg",
    "width": 4032,
    "height": 3024,
    "dataUrl": "data:image/jpeg;base64,...", // optional, see below
    "sha256": "9f2c...",
  },

  "crop": { "x": 0.1, "y": 0.05, "w": 0.8, "h": 0.8 }, // normalized
  "transform": { "rotate": 0, "flipH": false, "flipV": false },
  "mosaic": { "orientation": "pips-out", "cols": 48, "rows": 48 },
  "adjust": { "brightness": 0, "contrast": 12, "saturation": -5 },

  "quantize": {
    "dither": "none",
    "ditherStrength": 0,
    "maxColors": null,
    "strictAvailability": true,
    "enabledColors": ["white", "black", "red", "..."],
  },

  "tiler": {
    "inventory": [
      "3005",
      "3004",
      "3622",
      "3010",
      "3009",
      "3008",
      "3003",
      "3002",
      "3001",
      "2456",
      "3007",
    ],
    "weights": { "pieces": 1.0, "ones": 0.5, "seam": 0.25 },
    "restarts": 200,
    "seed": 1837462,
    "staggerLookback": [1.0, 0.4],
  },

  "palette": {
    "id": "builtin-v1",
    "overrides": [{ "key": "dark-turquoise", "hex": "#00939C" }],
  },

  "grid": {
    "cols": 48,
    "rows": 48,
    "encoding": "rle-v1",
    "colorKeys": ["white", "red", "black"],
    "data": [[0, 12], [1, 5], [2, 31], "..."], // [colorIndex, runLength]
  },
}
```

### 10.1 Design decisions

**The quantized grid is always stored.** RLE'd it is a few kilobytes, and it means a
project file always opens into something meaningful even without the source image.

**The source image is embedded by default, and optional.** Embedding makes the file
truly self-contained and re-editable (re-crop, re-quantize, change dimensions). It also
makes a 12-megapixel photo into a ~15 MB JSON file, so a _Settings only_ toggle at save
time drops `source.dataUrl`. Loading such a file still renders, still exports, still
re-tiles — only re-cropping and re-quantizing are unavailable, and the UI says so
plainly rather than failing at the moment of use.

**The tiling is never stored.** It is fully determined by `grid + tiler settings + seed`,
so it is recomputed on load. This keeps files small and makes it impossible for a stored
tiling to disagree with the settings that supposedly produced it.

**Versioned with a migration path.** `version` is checked on load and routed through a
`migrate(v)` chain. Unknown future versions produce a clear error rather than a partial
misread.

---

## 11. Export formats

### 11.1 Parts list CSV

```csv
color_name,bl_color_id,part_name,design_id,quantity
White,1,Brick 2 x 4,3001,84
White,1,Brick 1 x 2,3004,31
Red,5,Brick 2 x 2,3003,12
```

Sorted by color, then by descending part size. Standard RFC 4180 quoting.

### 11.2 BrickLink Wanted List XML

```xml
<INVENTORY>
  <ITEM>
    <ITEMTYPE>P</ITEMTYPE>
    <ITEMID>3001</ITEMID>
    <COLOR>1</COLOR>
    <MINQTY>84</MINQTY>
  </ITEM>
</INVENTORY>
```

Uploads directly to BrickLink, which then prices and sources the entire build. This is
where real pricing happens, and it is the highest-value export in the app.

**Validation:** a wrong `COLOR` id produces a silently wrong wanted list, which is worse
than no export. So every enabled color is checked for a numeric `blColorId` at palette
load; any color missing one is excluded from the XML and reported in the UI with the
affected quantities, rather than being emitted with a guessed id.

### 11.3 Mosaic PNG

Build view or clean view, at 1× / 2× / 4×, via `canvas.toBlob('image/png')`.

---

## 12. Performance and concurrency

Quantization and tiling run in a single Web Worker.

```
main ──{ type:'build', generation, grid params, settings }──▶ worker
main ◀──{ type:'progress', generation, pct }──────────────── worker
main ◀──{ type:'done', generation, grid, tiling, stats }──── worker
```

- Typed arrays are **transferred**, not copied.
- A monotonically increasing `generation` counter is attached to every request; results
  whose generation is stale are discarded. This is the cancellation mechanism — simpler
  and more robust than trying to abort work mid-flight.
- The tiler checks its time budget between restarts and reports progress, so a big grid
  produces a moving progress bar rather than a frozen tab.

**Sizing.** 128 × 128 = 16k cells is comfortable. 256 × 256 = 65k cells is the practical
ceiling for interactive use with restarts. A hard cap of 400 × 400 is enforced with a
warning above 256 in either dimension.

---

## 13. Testing strategy

Vitest over the pure modules in `src/lego/`. The invariants below are the contract; UI is
verified manually.

**color.ts**

- sRGB ↔ linear round-trips to within 1e-6.
- Known RGB → Lab conversions (white, black, mid-gray, primaries).
- `deltaE2000` against the Sharma/Wu/Dalal 34-pair reference dataset. Mandatory —
  CIEDE2000 is easy to get subtly wrong and the error is invisible without this test.

**palette.ts**

- Every entry has a valid hex, a numeric `blColorId`, and a non-empty `shapes` array.
- Every design ID referenced in `shapes` exists in the parts catalog.
- Filtering by enabled set and by strict availability behaves as specified.

**frame.ts**

- A solid-color source produces uniform cells.
- A 50/50 black-and-white source averages to linear 0.5 (sRGB ≈ 188, **not** 128).
  This is the gamma-correctness regression test.
- Pips-up sampling of a known-aspect test image is not vertically squashed.

**quantize.ts**

- A monochrome image maps to exactly one color.
- Dither strength 0 is bit-identical to dithering off.
- Colors disabled in the palette never appear in the output.

**tile-flat.ts / tile-wall.ts** — the six invariants from §7.4, plus:

- A solid 8×8 region of a fully-available color tiles in exactly 4 pieces using 2×8s
  (64 cells, 16 cells per 2×8 — the theoretical floor).
- Wall: a run of 5 tiles as 2 pieces (3+2); a run of 7 as 2 pieces (4+3).
- Wall: a solid rectangle produces zero aligned seams under default weights.
- Identical seeds produce identical output; different seeds produce valid output.

**bom.ts** — total quantity equals `placements.length`; grouping is exact.

**constants / geometry** — 48×48 pips-out is 15.118″; 48 courses pips-up is 18.142″.

**project.ts** — save → load round-trips to an identical state; RLE encode/decode
round-trips on random grids; a version-0 file is rejected with a clear message.

**exports** — CSV parses back to the same rows; XML parses via `DOMParser` with no
error node.

---

## 14. Edge cases and error handling

| Case                                                | Behavior                                                      |
| --------------------------------------------------- | ------------------------------------------------------------- |
| Non-image or corrupt file                           | Friendly inline error, prior state retained                   |
| Image > 40 MP                                       | Warn, offer automatic downscale                               |
| EXIF-rotated JPEG                                   | Handled via `imageOrientation: 'from-image'`                  |
| Transparent or grayscale PNG                        | Composited over the configured background                     |
| All palette colors disabled                         | Build blocked with an explanatory message                     |
| Color enabled but no legal shapes under strict mode | Auto-disabled, reported in UI                                 |
| Color with no `blColorId`                           | Excluded from XML export, reported with quantities            |
| Grid above 256 in either dimension                  | Warning; hard cap at 400                                      |
| Crop dragged outside image bounds                   | Clamped to the source rectangle                               |
| Load of a newer `version`                           | Rejected with a clear message, no partial read                |
| Load of a settings-only project                     | Renders and exports; re-crop/re-quantize disabled with a note |

---

## 15. Defaults

| Setting                    | Default                            | Reasoning                                                     |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| Orientation                | `pips-out`                         | square cells, most intuitive first result                     |
| Dimensions                 | 48 × 48                            | one standard baseplate, ~15″                                  |
| Max brick length           | 8 studs                            | longer bricks cost more per stud and have thin color coverage |
| 2×N bricks                 | on in pips-out, **off** in pips-up | in a wall they double cost and depth for zero visual change   |
| Dithering                  | off                                | it directly fights the large-brick goal                       |
| Strict availability        | on                                 | a parts list you can actually fill                            |
| `W_pieces` / `W_ones`      | 1.0 / 0.5                          |                                                               |
| `W_seam`                   | 0.25 flat, **0.5 in a wall**       | structural rather than cosmetic in a wall; see §7             |
| Restarts (pips-out)        | 200, 1.5 s budget                  |                                                               |
| Stagger lookback (pips-up) | `[1.0, 0.4]`                       | two courses back, decaying                                    |
| Render                     | build view, 24 px/stud, 1×         |                                                               |

---

## 16. Future work

Ordered roughly by value per unit of effort.

1. **Build guide export** — per-course (pips-up) or per-region (pips-out) placement
   instructions with coordinates, so the mosaic can be built without eyeballing the PNG.
2. **Plates and tiles** — plates at 3.2 mm open up a 5:2 cell and much finer vertical
   resolution in wall mode; tiles give a genuinely smooth pips-out surface.
3. **Undo / redo** on the settings stack.
4. **Per-part cost weighting** in the objective, once real price data is available.
5. **Region-locked colors** — pin an area to a chosen color and re-run.
6. **Multi-baseplate segmentation** for pips-out, with per-plate parts lists.
7. **Second-layer backing** generation for tall pips-up walls.
8. **CLI** over `src/lego/` — the module boundary already permits it.

---

## 17. Open decisions

None blocking. The four settled during design review, recorded here so they are not
relitigated:

1. Max brick length is 8; 1×10 through 1×16 available but off by default.
2. 2×N bricks are pips-out only.
3. Dithering defaults to off.
4. Strict availability filtering defaults to on.
