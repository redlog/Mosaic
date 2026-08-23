# Rebrickable catalog extract

The source data behind `src/lego/palette.data.json`. Checked in so the palette can be
rebuilt from scratch without network access — the build environment's policy denies
rebrickable.com, and a generated file nobody can regenerate is a liability.

| File           | Rows | Contents                                                      |
| -------------- | ---: | ------------------------------------------------------------- |
| `colors.csv`   |  275 | Every color in the catalog, verbatim from the upstream export |
| `parts.csv`    |   11 | Only the brick shapes in `src/lego/parts.ts`                  |
| `elements.csv` | 1318 | Only the elements whose `part_num` is one of those 11         |

`parts.csv` and `elements.csv` are row-filtered copies — no cell was edited, and column
order is preserved. The unfiltered `elements.csv` is ~113k rows covering every part in
the catalog, which is 4 MB of data this app has no use for.

**Source:** Rebrickable's public database export (<https://rebrickable.com/downloads/>),
retrieved 2026-08-23. Rebrickable publishes it under CC BY-SA 4.0; see their downloads
page for the current terms.

## Reading it

- `colors.csv` — `id` is **Rebrickable's** color ID, which for the classic range matches
  the LDraw color code. It is _not_ the LEGO color number and _not_ the BrickLink color
  ID. Nothing in this repo derives a BrickLink ID from it; see the note in
  `scripts/rebrickable.ts`.
- `elements.csv` — `element_id` is the number lego.com's Pick a Brick accepts.
  `design_id` is LEGO's design number for that element, which differs from `part_num`
  when the element is a later mold of the same part.
- A (`part_num`, `color_id`) pair can appear several times, once per element ever issued
  for it. `scripts/rebrickable.ts` explains which one the palette keeps.

## Refreshing

Download the current `colors.csv`, `parts.csv` and `elements.csv` from Rebrickable,
filter the latter two to the design IDs in `src/lego/parts.ts`, drop them here, then:

```
npm run palette:build
```
