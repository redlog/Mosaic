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

Design complete. Implementation not started.

- [DESIGN.md](./DESIGN.md) — full design: geometry, algorithms, data model, UI, formats
- [TODO.md](./TODO.md) — phased implementation plan

## Getting started

Not yet runnable — see Phase 0 in [TODO.md](./TODO.md).

## A note on the color data

The palette ships as a plain, hand-editable JSON file. Its hex values and BrickLink
color IDs come from reference tables and are **not independently verified against current
production**, so treat the parts list as a strong starting point rather than gospel —
and correct the JSON directly if you find a wrong value.
