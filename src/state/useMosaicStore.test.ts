import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLOR_KEYS,
  REQUIRED_SHAPE,
  initialState,
  palette,
  reducer,
  withAspect,
  type MosaicState,
  type SourceState,
} from './useMosaicStore';
import { cropAspectFor } from '../lego/frame';
import { finishedSize, MAX_GRID_DIMENSION, MIN_GRID_DIMENSION } from '../lego/constants';
import { DEFAULT_WALL_WEIGHTS, DEFAULT_WEIGHTS } from '../lego/score';

const source: SourceState = {
  name: 'test.jpg',
  image: { width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4) },
  naturalWidth: 800,
  naturalHeight: 600,
  dataUrl: 'data:image/jpeg;base64,',
};

const loaded = (): MosaicState => reducer(initialState(), { type: 'setSource', source });

/** Physical width / height of a crop of the 800x600 fixture. */
const pixelAspect = (c: { w: number; h: number }) => (c.w * 800) / (c.h * 600);

describe('withAspect', () => {
  it('reshapes a crop to the target aspect', () => {
    const crop = withAspect({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, 800, 600, 1);
    expect((crop.w * 800) / (crop.h * 600)).toBeCloseTo(1, 6);
  });

  it('keeps the centre where it was', () => {
    const crop = withAspect({ x: 0.1, y: 0.3, w: 0.4, h: 0.4 }, 800, 600, 1.5);
    expect(crop.x + crop.w / 2).toBeCloseTo(0.3, 6);
    expect(crop.y + crop.h / 2).toBeCloseTo(0.5, 6);
  });

  it('shrinks rather than overflowing the image', () => {
    const crop = withAspect({ x: 0, y: 0, w: 1, h: 1 }, 800, 600, 0.5);
    expect(crop.w).toBeLessThanOrEqual(1);
    expect(crop.h).toBeLessThanOrEqual(1);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y + crop.h).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('handles the 5:6 wall aspect without distorting', () => {
    const aspect = cropAspectFor(48, 48, 'pips-up');
    const crop = withAspect({ x: 0, y: 0, w: 1, h: 1 }, 800, 800, aspect);
    expect((crop.w * 800) / (crop.h * 800)).toBeCloseTo(5 / 6, 6);
  });
});

describe('setSource', () => {
  it('frames a cover crop at the mosaic aspect', () => {
    const state = loaded();
    const built = finishedSize(
      state.mosaic.cols,
      state.mosaic.rows,
      state.mosaic.orientation
    );
    const cropAspect = (state.crop.w * 800) / (state.crop.h * 600);
    expect(cropAspect).toBeCloseTo(built.widthMm / built.heightMm, 6);
  });

  it('clears any previous error', () => {
    const errored = reducer(initialState(), { type: 'setError', error: 'boom' });
    expect(reducer(errored, { type: 'setSource', source }).error).toBeNull();
  });
});

describe('orientation', () => {
  it('switches the inventory and the seam weight together', () => {
    const wall = reducer(loaded(), {
      type: 'patchMosaic',
      patch: { orientation: 'pips-up' },
    });
    // A wall is 1xN only, and its seams are structural rather than cosmetic.
    expect(wall.tiler.inventory).not.toContain('3001');
    expect(wall.tiler.weights).toEqual(DEFAULT_WALL_WEIGHTS);

    const flat = reducer(wall, {
      type: 'patchMosaic',
      patch: { orientation: 'pips-out' },
    });
    expect(flat.tiler.inventory).toContain('3001');
    expect(flat.tiler.weights).toEqual(DEFAULT_WEIGHTS);
  });

  /**
   * Switching to a wall must not distort: the same crop sampled on 5:6 cells
   * comes out vertically stretched unless something gives. Which side gives is
   * what `linkAspect` decides.
   */
  it('recounts the courses rather than recropping, when the crop leads', () => {
    const flat = loaded();
    const wall = reducer(flat, {
      type: 'patchMosaic',
      patch: { orientation: 'pips-up' },
    });

    // The framing the user chose survives untouched. Pips-up courses are 1.2x
    // taller, so the same picture needs 1/1.2 as many of them — and finishes
    // at the same physical size, which is the point.
    expect(wall.crop).toEqual(flat.crop);
    expect(wall.mosaic.cols).toBe(flat.mosaic.cols);
    expect(wall.mosaic.rows).toBeCloseTo(flat.mosaic.rows / 1.2, 0);

    const before = finishedSize(flat.mosaic.cols, flat.mosaic.rows, 'pips-out');
    const after = finishedSize(wall.mosaic.cols, wall.mosaic.rows, 'pips-up');
    expect(after.heightMm).toBeCloseTo(before.heightMm, 0);
    expect(pixelAspect(wall.crop)).toBeCloseTo(after.widthMm / after.heightMm, 2);
  });

  it('recrops instead, when the grid leads', () => {
    const flat = reducer(loaded(), {
      type: 'patchMosaic',
      patch: { linkAspect: false },
    });
    const wall = reducer(flat, {
      type: 'patchMosaic',
      patch: { orientation: 'pips-up' },
    });

    // Brick counts are the user's here, so the crop is what narrows: the same
    // grid on 5:6 cells needs a crop 5/6 as wide.
    expect(wall.mosaic.rows).toBe(flat.mosaic.rows);
    expect(wall.crop.w).toBeLessThan(flat.crop.w);
    expect(pixelAspect(wall.crop)).toBeCloseTo(pixelAspect(flat.crop) * (5 / 6), 6);
  });

  /**
   * The one thing neither mode may ever do. A crop whose proportions differ
   * from the finished mosaic's is a stretched picture, and it is silent — the
   * render looks fine until you hold it up against the photo.
   */
  it('keeps crop and mosaic proportions equal through every path', () => {
    const paths: Array<[string, MosaicState]> = [];
    for (const linkAspect of [true, false]) {
      let s = reducer(loaded(), { type: 'patchMosaic', patch: { linkAspect } });
      paths.push([`load, link=${linkAspect}`, s]);
      s = reducer(s, { type: 'setCrop', crop: { x: 0, y: 0.1, w: 0.9, h: 0.4 } });
      paths.push([`crop, link=${linkAspect}`, s]);
      s = reducer(s, { type: 'patchMosaic', patch: { cols: 120 } });
      paths.push([`cols, link=${linkAspect}`, s]);
      s = reducer(s, { type: 'patchMosaic', patch: { rows: 30 } });
      paths.push([`rows, link=${linkAspect}`, s]);
      s = reducer(s, { type: 'patchMosaic', patch: { orientation: 'pips-up' } });
      paths.push([`wall, link=${linkAspect}`, s]);
    }

    for (const [label, s] of paths) {
      const built = finishedSize(s.mosaic.cols, s.mosaic.rows, s.mosaic.orientation);
      // Whole bricks cannot express every ratio exactly; 1% is well under what
      // any eye would catch, and the rounding is always the crop's to absorb.
      expect(
        Math.abs(pixelAspect(s.crop) / (built.widthMm / built.heightMm) - 1),
        label
      ).toBeLessThan(0.01);
    }
  });
});

describe('grid dimensions', () => {
  it('clamps to the supported range', () => {
    const state = { ...loaded(), mosaic: { ...loaded().mosaic, linkAspect: false } };
    expect(reducer(state, { type: 'patchMosaic', patch: { cols: 5 } }).mosaic.cols).toBe(
      MIN_GRID_DIMENSION
    );
    expect(
      reducer(state, { type: 'patchMosaic', patch: { cols: 9999 } }).mosaic.cols
    ).toBe(MAX_GRID_DIMENSION);
  });

  it('rounds fractional input', () => {
    const state = { ...loaded(), mosaic: { ...loaded().mosaic, linkAspect: false } };
    expect(
      reducer(state, { type: 'patchMosaic', patch: { cols: 33.7 } }).mosaic.cols
    ).toBe(34);
  });

  it('derives the other dimension from the crop', () => {
    const state = loaded();
    expect(state.mosaic.linkAspect).toBe(true);

    // A full-frame crop of the 4:3 fixture: 64 columns wants 48 rows.
    expect(reducer(state, { type: 'patchMosaic', patch: { cols: 64 } }).mosaic.rows).toBe(
      48
    );

    // Give it a genuinely wide crop and the derived height follows that.
    const wideCrop = reducer(state, {
      type: 'setCrop',
      crop: { x: 0, y: 0.25, w: 1, h: 0.5 },
    });
    // (1 * 800) / (0.5 * 600) = 2.667, so 64 columns wants 24 rows.
    expect(
      reducer(wideCrop, { type: 'patchMosaic', patch: { cols: 64 } }).mosaic.rows
    ).toBe(24);
  });

  /**
   * The bug this replaced: the crop was fitted to the *grid* on load, so a
   * 48x48 default made every photo square, and with the crop then locked to
   * the grid and the grid derived from the crop, nothing could ever break the
   * tie. Square was a fixed point you could not leave.
   */
  it('takes its proportions from the photo, not from the previous grid', () => {
    const state = loaded();
    expect(state.mosaic.cols / state.mosaic.rows).toBeCloseTo(4 / 3, 2);
    expect(state.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });

    const portrait = reducer(initialState(), {
      type: 'setSource',
      source: { ...source, naturalWidth: 600, naturalHeight: 900 },
    });
    expect(portrait.mosaic.rows).toBeGreaterThan(portrait.mosaic.cols);
  });

  it('reshapes the grid when the crop is dragged', () => {
    const tall = reducer(loaded(), {
      type: 'setCrop',
      crop: { x: 0.3, y: 0, w: 0.25, h: 1 },
    });
    // (0.25 * 800) / (1 * 600) = 0.333 — a tall, narrow mosaic.
    expect(tall.mosaic.rows).toBeGreaterThan(tall.mosaic.cols * 2);
    expect(tall.crop.w).toBeCloseTo(0.25, 2);
  });

  it('leaves the grid alone when the crop is dragged and the grid leads', () => {
    const locked = reducer(loaded(), {
      type: 'patchMosaic',
      patch: { linkAspect: false },
    });
    const dragged = reducer(locked, {
      type: 'setCrop',
      crop: { x: 0.3, y: 0, w: 0.25, h: 1 },
    });
    expect(dragged.mosaic).toEqual(locked.mosaic);
    // The width the drag asked for is honoured; the height is the grid's to
    // dictate, so the crop comes back reshaped rather than as handed in.
    expect(dragged.crop.w).toBeCloseTo(0.25, 6);
    const built = finishedSize(
      locked.mosaic.cols,
      locked.mosaic.rows,
      locked.mosaic.orientation
    );
    expect(pixelAspect(dragged.crop)).toBeCloseTo(built.widthMm / built.heightMm, 6);
  });

  it('absorbs a clamped derivation into the crop rather than distorting', () => {
    // A crop this wide wants far fewer rows than the minimum allows, so the
    // derived count clamps — and the crop has to give way to stay honest.
    const sliver = reducer(loaded(), {
      type: 'setCrop',
      crop: { x: 0, y: 0.48, w: 1, h: 0.04 },
    });
    expect(sliver.mosaic.rows).toBe(MIN_GRID_DIMENSION);

    const built = finishedSize(
      sliver.mosaic.cols,
      sliver.mosaic.rows,
      sliver.mosaic.orientation
    );
    expect(pixelAspect(sliver.crop)).toBeCloseTo(built.widthMm / built.heightMm, 2);
  });

  it('leaves the other dimension alone when unlinked', () => {
    const state = reducer(loaded(), {
      type: 'patchMosaic',
      patch: { linkAspect: false },
    });
    const wide = reducer(state, { type: 'patchMosaic', patch: { cols: 64 } });
    expect(wide.mosaic.rows).toBe(state.mosaic.rows);
  });
});

describe('palette selection', () => {
  it('starts on the standard colors, with the rest available but off', () => {
    const enabled = initialState().quantizeSettings.enabledColors;
    expect(enabled).toEqual([...DEFAULT_COLOR_KEYS]);
    expect(enabled.length).toBeLessThan(palette.colors.length);
    for (const key of enabled) {
      expect(palette.byKey.get(key)!.finish ?? 'solid').toBe('solid');
    }
  });

  it('toggles a color off and back on', () => {
    const key = DEFAULT_COLOR_KEYS[3]!;
    const off = reducer(initialState(), { type: 'toggleColor', key });
    expect(off.quantizeSettings.enabledColors).not.toContain(key);
    expect(
      reducer(off, { type: 'toggleColor', key }).quantizeSettings.enabledColors
    ).toContain(key);
  });

  it('keeps palette order when re-enabling', () => {
    const key = DEFAULT_COLOR_KEYS[3]!;
    const round = reducer(reducer(initialState(), { type: 'toggleColor', key }), {
      type: 'toggleColor',
      key,
    });
    expect(round.quantizeSettings.enabledColors).toEqual(
      initialState().quantizeSettings.enabledColors
    );
  });

  /** Quantizing against nothing has no defined answer, so this is blocked. */
  it('refuses to empty the palette', () => {
    // Switch everything on first: a new project starts with a subset, so
    // toggling each key once would turn the rest on rather than clearing it.
    let state = reducer(initialState(), {
      type: 'setColors',
      keys: palette.colors.map((c) => c.key),
    });
    for (const color of palette.colors) {
      state = reducer(state, { type: 'toggleColor', key: color.key });
    }
    expect(state.quantizeSettings.enabledColors.length).toBeGreaterThan(0);
    expect(reducer(state, { type: 'setColors', keys: [] })).toBe(state);
  });
});

describe('brick inventory', () => {
  /** Without a 1x1, some regions cannot be covered at all. */
  it('will not remove the 1x1', () => {
    const state = initialState();
    const after = reducer(state, { type: 'toggleShape', designId: REQUIRED_SHAPE });
    expect(after).toBe(state);
    expect(after.tiler.inventory).toContain(REQUIRED_SHAPE);
  });

  it('toggles other shapes, and keeps the 1x1 regardless', () => {
    const off = reducer(initialState(), { type: 'toggleShape', designId: '3001' });
    expect(off.tiler.inventory).not.toContain('3001');
    expect(off.tiler.inventory).toContain(REQUIRED_SHAPE);
    expect(
      reducer(off, { type: 'toggleShape', designId: '3001' }).tiler.inventory
    ).toContain('3001');
  });
});

describe('misc actions', () => {
  it('randomizes the seed to something new', () => {
    const state = initialState();
    const seeds = new Set(
      Array.from(
        { length: 20 },
        () => reducer(state, { type: 'randomizeSeed' }).tiler.seed
      )
    );
    expect(seeds.size).toBeGreaterThan(10);
  });

  it('clears the source back to a blank slate but keeps the view', () => {
    const viewed = reducer(loaded(), { type: 'patchView', patch: { mode: 'clean' } });
    const cleared = reducer(viewed, { type: 'clearSource' });
    expect(cleared.source).toBeNull();
    expect(cleared.view.mode).toBe('clean');
  });

  it('clamps a crop pushed outside the image', () => {
    const state = reducer(loaded(), {
      type: 'setCrop',
      crop: { x: -0.5, y: 2, w: 0.5, h: 0.5 },
    });
    expect(state.crop.x).toBeGreaterThanOrEqual(0);
    expect(state.crop.y + state.crop.h).toBeLessThanOrEqual(1 + 1e-9);
  });
});
