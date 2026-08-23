import { describe, expect, it } from 'vitest';
import {
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
};

const loaded = (): MosaicState => reducer(initialState(), { type: 'setSource', source });

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
   * Switching to a wall must reshape the crop, or the same crop sampled on
   * 5:6 cells comes out vertically stretched.
   */
  it('reshapes the crop so the picture is not distorted', () => {
    const flat = loaded();
    const wall = reducer(flat, {
      type: 'patchMosaic',
      patch: { orientation: 'pips-up' },
    });
    const pixelAspect = (c: { w: number; h: number }) => (c.w * 800) / (c.h * 600);

    // The crop already spans the full height, so holding the new 5:6 shape
    // narrows it rather than making it taller: 1.0000 -> 0.8333.
    expect(pixelAspect(flat.crop)).toBeCloseTo(1, 6);
    expect(pixelAspect(wall.crop)).toBeCloseTo(5 / 6, 6);
    expect(wall.crop.w).toBeLessThan(flat.crop.w);

    const built = finishedSize(wall.mosaic.cols, wall.mosaic.rows, 'pips-up');
    expect(pixelAspect(wall.crop)).toBeCloseTo(built.widthMm / built.heightMm, 6);
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

  it('derives the other dimension from the crop, not the source image', () => {
    // The crop has already been fit to the square 48x48 mosaic, so it is
    // square regardless of the 4:3 source — and the grid stays square too.
    const square = loaded();
    expect(square.mosaic.linkAspect).toBe(true);
    expect(
      reducer(square, { type: 'patchMosaic', patch: { cols: 64 } }).mosaic.rows
    ).toBe(64);

    // Give it a genuinely wide crop and the derived height follows that.
    const wideCrop = reducer(square, {
      type: 'setCrop',
      crop: { x: 0, y: 0.25, w: 1, h: 0.5 },
    });
    // (1 * 800) / (0.5 * 600) = 2.667, so 64 columns wants 24 rows.
    expect(
      reducer(wideCrop, { type: 'patchMosaic', patch: { cols: 64 } }).mosaic.rows
    ).toBe(24);
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
  it('toggles a color off and back on', () => {
    const key = palette.colors[3]!.key;
    const off = reducer(initialState(), { type: 'toggleColor', key });
    expect(off.quantizeSettings.enabledColors).not.toContain(key);
    expect(
      reducer(off, { type: 'toggleColor', key }).quantizeSettings.enabledColors
    ).toContain(key);
  });

  it('keeps palette order when re-enabling', () => {
    const key = palette.colors[3]!.key;
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
    let state = initialState();
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
