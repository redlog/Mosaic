/**
 * The whole application state, and the derived pipeline hanging off it.
 *
 * Each pipeline stage is memoized on its own inputs, so changing a tiler
 * weight does not re-decode the image and moving the crop does not re-run
 * palette selection (DESIGN.md §6).
 */
import { useCallback, useMemo, useReducer } from 'react';
import { applyAdjustments, NO_ADJUSTMENTS } from '../lego/adjust';
import { buildBom, type Bom } from '../lego/bom';
import {
  centerCropForAspect,
  clampCrop,
  cropAspectFor,
  frameImage,
  IDENTITY_TRANSFORM,
} from '../lego/frame';
import {
  MAX_GRID_DIMENSION,
  MIN_GRID_DIMENSION,
  WARN_GRID_DIMENSION,
  baseplatesFor,
  cellSize,
  finishedSize,
} from '../lego/constants';
import { enabledColors as selectColors, unusableColors } from '../lego/palette';
import { palette, type BuildSettings } from '../lego/build';
import { useMosaicPipeline, type PipelineSource } from './useMosaicWorker';
import { defaultInventoryFor } from '../lego/parts';
import type { DitherMode } from '../lego/quantize';
import { DEFAULT_WALL_WEIGHTS, DEFAULT_WEIGHTS } from '../lego/score';
import { randomSeed } from '../lego/rng';
import type { RenderMode } from '../lego/render';
import type {
  Adjustments,
  CropRect,
  Grid,
  LegoColor,
  Orientation,
  SourceImage,
  TilerWeights,
  Tiling,
  Transform,
} from '../lego/types';

export { palette };
const allColors = [...palette.colors];

/** The 1x1 is mandatory: without it some regions cannot be covered at all. */
export const REQUIRED_SHAPE = '3005';

/**
 * Tiling runs in a worker, so the budget is the design's full one rather than
 * something trimmed to keep the main thread responsive.
 */
export const DEFAULT_BUDGET_MS = 1500;
export const DEFAULT_RESTARTS = 200;

export interface SourceState {
  name: string;
  image: SourceImage;
  naturalWidth: number;
  naturalHeight: number;
  /** Original bytes, kept so a project can embed the image it started from. */
  dataUrl: string;
}

export interface MosaicSettings {
  orientation: Orientation;
  cols: number;
  rows: number;
  /**
   * Which side of the crop/grid coupling is the master.
   *
   * The crop's physical aspect must always equal the mosaic's, or the picture
   * comes out stretched (DESIGN.md §2.4a). That is not negotiable; what is
   * negotiable is which one gives way. When true the crop leads — drag it to
   * any shape and the brick counts follow. When false the grid leads — set the
   * counts and the crop is reshaped to match.
   */
  linkAspect: boolean;
}

export interface QuantizeSettings {
  dither: DitherMode;
  ditherStrength: number;
  maxColors: number | null;
  strict: boolean;
  enabledColors: string[];
}

export interface TilerSettings {
  inventory: string[];
  weights: TilerWeights;
  restarts: number;
  budgetMs: number;
  seed: number;
}

export type ViewMode = RenderMode | 'source';

export interface ViewSettings {
  mode: ViewMode;
  pxPerStud: number;
}

export interface MosaicState {
  source: SourceState | null;
  /**
   * A grid restored from a project saved without its image. Present only when
   * `source` is null; re-cropping and re-quantizing are unavailable then, but
   * rendering, re-tiling and exporting all work.
   */
  loadedGrid: { grid: Grid; colorKeys: string[] } | null;
  /** Filename the project was opened from, used to name exports. */
  projectName: string | null;
  crop: CropRect;
  transform: Transform;
  mosaic: MosaicSettings;
  adjust: Adjustments;
  quantizeSettings: QuantizeSettings;
  tiler: TilerSettings;
  view: ViewSettings;
  /**
   * Rebuild automatically as settings change. Off turns the app into an
   * explicit "change what you like, then press Rebuild" loop, which is worth
   * having at grid sizes where even a single tile takes a noticeable moment.
   * A UI preference, deliberately not part of the saved project.
   */
  autoRebuild: boolean;
  error: string | null;
}

export function initialState(): MosaicState {
  return {
    source: null,
    loadedGrid: null,
    projectName: null,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    transform: IDENTITY_TRANSFORM,
    mosaic: { orientation: 'pips-out', cols: 48, rows: 48, linkAspect: true },
    adjust: NO_ADJUSTMENTS,
    quantizeSettings: {
      dither: 'none',
      ditherStrength: 0,
      maxColors: null,
      strict: true,
      enabledColors: allColors.map((c) => c.key),
    },
    tiler: {
      inventory: [...defaultInventoryFor('pips-out')],
      weights: DEFAULT_WEIGHTS,
      restarts: DEFAULT_RESTARTS,
      budgetMs: DEFAULT_BUDGET_MS,
      seed: 1,
    },
    view: { mode: 'build', pxPerStud: 14 },
    autoRebuild: true,
    error: null,
  };
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * The crop's own physical aspect, as width / height in real-world proportions.
 * The normalized rect is relative to the image, so the image's own dimensions
 * have to come back in.
 */
export function cropAspect(
  crop: CropRect,
  imageWidth: number,
  imageHeight: number
): number {
  return (crop.w * imageWidth) / (crop.h * imageHeight);
}

/**
 * Brick counts matching a crop's shape, holding one dimension fixed.
 *
 * The inverse of `withAspect`: instead of bending the crop to the grid, bend
 * the grid to the crop. `hold` says which count the user just chose and must
 * therefore be left alone.
 */
export function gridForAspect(
  aspect: number,
  orientation: Orientation,
  hold: { cols: number } | { rows: number }
): { cols: number; rows: number } {
  const cellRatio = cellSize(orientation).h / cellSize(orientation).w;
  const fit = (v: number) => clamp(Math.round(v), MIN_GRID_DIMENSION, MAX_GRID_DIMENSION);
  // mosaicAspect = cols / (rows * cellRatio); solve for the other side.
  return 'cols' in hold
    ? { cols: fit(hold.cols), rows: fit(fit(hold.cols) / (aspect * cellRatio)) }
    : { cols: fit(fit(hold.rows) * aspect * cellRatio), rows: fit(hold.rows) };
}

/**
 * Reshape a crop to a target physical aspect, keeping its centre and staying
 * inside the image. Used when the grid leads (`linkAspect` false), and to
 * repair the crop when a derived brick count hits a limit and clamps.
 */
export function withAspect(
  crop: CropRect,
  imageWidth: number,
  imageHeight: number,
  aspect: number
): CropRect {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;

  let w = crop.w;
  let h = (w * imageWidth) / (aspect * imageHeight);
  if (h > 1) {
    h = 1;
    w = (aspect * imageHeight) / imageWidth;
  }
  if (w > 1) {
    w = 1;
    h = (w * imageWidth) / (aspect * imageHeight);
  }

  return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export type Action =
  | { type: 'setSource'; source: SourceState }
  | { type: 'clearSource' }
  | { type: 'setCrop'; crop: CropRect }
  | { type: 'fitCrop' }
  | { type: 'patchMosaic'; patch: Partial<MosaicSettings> }
  | { type: 'patchTransform'; patch: Partial<Transform> }
  | { type: 'patchAdjust'; patch: Partial<Adjustments> }
  | { type: 'patchQuantize'; patch: Partial<QuantizeSettings> }
  | { type: 'patchTiler'; patch: Partial<TilerSettings> }
  | { type: 'patchView'; patch: Partial<ViewSettings> }
  | { type: 'toggleColor'; key: string }
  | { type: 'setColors'; keys: string[] }
  | { type: 'toggleShape'; designId: string }
  | { type: 'randomizeSeed' }
  | { type: 'setAutoRebuild'; auto: boolean }
  | { type: 'setError'; error: string | null }
  | { type: 'loadProject'; state: MosaicState }
  | { type: 'replace'; state: MosaicState };

function refit(state: MosaicState, crop = state.crop): CropRect {
  if (!state.source) return crop;
  const { orientation, cols, rows } = state.mosaic;
  const { naturalWidth: w, naturalHeight: h } = state.source;
  return withAspect(crop, w, h, cropAspectFor(cols, rows, orientation));
}

export function reducer(state: MosaicState, action: Action): MosaicState {
  switch (action.type) {
    case 'setSource': {
      // A real image supersedes any grid restored from a project.
      const next: MosaicState = {
        ...state,
        source: action.source,
        loadedGrid: null,
        error: null,
      };
      const { naturalWidth: w, naturalHeight: h } = action.source;

      if (state.mosaic.linkAspect) {
        // The crop leads, so start from the whole photo and let the brick
        // counts take its shape. A landscape photo should open as a landscape
        // mosaic; forcing it into the previous grid's proportions is what made
        // every mosaic square regardless of its subject.
        next.crop = { x: 0, y: 0, w: 1, h: 1 };
        next.mosaic = {
          ...state.mosaic,
          ...gridForAspect(w / h, state.mosaic.orientation, {
            cols: state.mosaic.cols,
          }),
        };
        // Rounding to whole bricks moves the aspect slightly; the crop has to
        // follow exactly or the picture stretches.
        next.crop = refit(next);
        return next;
      }

      next.crop = centerCropForAspect(
        w,
        h,
        cropAspectFor(state.mosaic.cols, state.mosaic.rows, state.mosaic.orientation)
      );
      return next;
    }

    case 'setAutoRebuild':
      return { ...state, autoRebuild: action.auto };

    case 'clearSource':
      return { ...initialState(), view: state.view, autoRebuild: state.autoRebuild };

    case 'setCrop': {
      const crop = clampCrop(action.crop);
      if (!state.source) return { ...state, crop };
      // Grid leads: the crop is reshaped to it. The overlay already holds this
      // shape while dragging, but enforcing it here means the invariant does
      // not depend on the UI being the only caller.
      if (!state.mosaic.linkAspect) return { ...state, crop: refit(state, crop) };

      // The crop leads: reshaping it re-proportions the grid. Width in bricks
      // is what the user set explicitly, so that is what is held.
      const { naturalWidth: w, naturalHeight: h } = state.source;
      const next: MosaicState = {
        ...state,
        crop,
        mosaic: {
          ...state.mosaic,
          ...gridForAspect(cropAspect(crop, w, h), state.mosaic.orientation, {
            cols: state.mosaic.cols,
          }),
        },
      };
      // Whole bricks cannot express every aspect exactly, and a derived count
      // can clamp at the grid limits. Either way the crop yields the remainder,
      // so the two never disagree.
      return { ...next, crop: refit(next, crop) };
    }

    case 'fitCrop': {
      if (!state.source) return state;
      const aspect = cropAspectFor(
        state.mosaic.cols,
        state.mosaic.rows,
        state.mosaic.orientation
      );
      return {
        ...state,
        crop: centerCropForAspect(
          state.source.naturalWidth,
          state.source.naturalHeight,
          aspect
        ),
      };
    }

    case 'patchMosaic': {
      const mosaic = { ...state.mosaic, ...action.patch };
      mosaic.cols = clamp(
        Math.round(mosaic.cols),
        MIN_GRID_DIMENSION,
        MAX_GRID_DIMENSION
      );
      mosaic.rows = clamp(
        Math.round(mosaic.rows),
        MIN_GRID_DIMENSION,
        MAX_GRID_DIMENSION
      );

      let tiler = state.tiler;
      if (
        action.patch.orientation &&
        action.patch.orientation !== state.mosaic.orientation
      ) {
        // 2xN bricks make a wall two studs deep for no visual gain, so the
        // inventory default differs by orientation.
        tiler = {
          ...tiler,
          inventory: [...defaultInventoryFor(action.patch.orientation)],
          weights:
            action.patch.orientation === 'pips-up'
              ? DEFAULT_WALL_WEIGHTS
              : DEFAULT_WEIGHTS,
        };
      }

      // When the crop leads, the *other* dimension follows it. Whichever count
      // the user just moved is the one held fixed.
      if (state.mosaic.linkAspect && state.source) {
        const aspect = cropAspect(
          state.crop,
          state.source.naturalWidth,
          state.source.naturalHeight
        );
        if (action.patch.rows !== undefined) {
          Object.assign(
            mosaic,
            gridForAspect(aspect, mosaic.orientation, { rows: mosaic.rows })
          );
        } else if (
          action.patch.cols !== undefined ||
          action.patch.orientation !== undefined
        ) {
          // Orientation counts too. Pips-up cells are 1.2x taller, so the same
          // framing is covered by fewer, taller courses at the same finished
          // size — rather than by cropping the top and bottom off the picture.
          Object.assign(
            mosaic,
            gridForAspect(aspect, mosaic.orientation, { cols: mosaic.cols })
          );
        }
      }

      const next = { ...state, mosaic, tiler };
      return { ...next, crop: refit(next) };
    }

    case 'patchTransform': {
      const next = { ...state, transform: { ...state.transform, ...action.patch } };
      return { ...next, crop: refit(next) };
    }

    case 'patchAdjust':
      return { ...state, adjust: { ...state.adjust, ...action.patch } };

    case 'patchQuantize':
      return {
        ...state,
        quantizeSettings: { ...state.quantizeSettings, ...action.patch },
      };

    case 'patchTiler':
      return { ...state, tiler: { ...state.tiler, ...action.patch } };

    case 'patchView':
      return { ...state, view: { ...state.view, ...action.patch } };

    case 'toggleColor': {
      const current = new Set(state.quantizeSettings.enabledColors);
      if (current.has(action.key)) current.delete(action.key);
      else current.add(action.key);
      // Never allow an empty palette; quantize would have nothing to pick.
      if (current.size === 0) return state;
      return {
        ...state,
        quantizeSettings: {
          ...state.quantizeSettings,
          enabledColors: allColors.filter((c) => current.has(c.key)).map((c) => c.key),
        },
      };
    }

    case 'setColors': {
      if (action.keys.length === 0) return state;
      return {
        ...state,
        quantizeSettings: { ...state.quantizeSettings, enabledColors: action.keys },
      };
    }

    case 'toggleShape': {
      if (action.designId === REQUIRED_SHAPE) return state;
      const current = new Set(state.tiler.inventory);
      if (current.has(action.designId)) current.delete(action.designId);
      else current.add(action.designId);
      current.add(REQUIRED_SHAPE);
      return {
        ...state,
        tiler: { ...state.tiler, inventory: [...current] },
      };
    }

    case 'randomizeSeed':
      return { ...state, tiler: { ...state.tiler, seed: randomSeed() } };

    case 'setError':
      return { ...state, error: action.error };

    case 'loadProject':
    case 'replace':
      return action.state;
  }
}

export interface DerivedMosaic {
  /** Colors actually offered to the quantizer. */
  activeColors: LegoColor[];
  tiling: Tiling | null;
  bom: Bom | null;
  /** Cell colors, parallel to the grid's indices. */
  gridColors: LegoColor[];
  /** Palette keys in index order, for serializing the grid. */
  colorKeys: string[];
  grid: Grid | null;
  counts: number[];
  size: ReturnType<typeof finishedSize>;
  baseplates: ReturnType<typeof baseplatesFor>;
  warnings: string[];
  tooLarge: boolean;
  elapsedMs: number;
}

export function useMosaicStore() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const { source, loadedGrid, crop, transform, mosaic, adjust, quantizeSettings, tiler } =
    state;

  /**
   * Colors offered to the quantizer. Under strict availability a color with no
   * legal brick in the current inventory is dropped rather than left to fail
   * mid-tile — unless that would empty the palette entirely.
   */
  const activeColors = useMemo(() => {
    const enabled = selectColors(palette, quantizeSettings.enabledColors);
    if (!quantizeSettings.strict) return enabled;
    const unusable = new Set(unusableColors(enabled, tiler.inventory).map((c) => c.key));
    const usable = enabled.filter((c) => !unusable.has(c.key));
    return usable.length > 0 ? usable : enabled;
  }, [quantizeSettings.enabledColors, quantizeSettings.strict, tiler.inventory]);

  // Framing and adjustment stay on the main thread: they are cheap relative to
  // tiling, and keeping the source pixels here avoids shipping a 30MB buffer
  // across the wire on every crop nudge.
  const framed = useMemo(
    () =>
      source
        ? frameImage(source.image, mosaic.cols, mosaic.rows, { crop, transform })
        : null,
    [source, mosaic.cols, mosaic.rows, crop, transform]
  );

  const adjusted = useMemo(
    () => (framed ? applyAdjustments(framed, adjust) : null),
    [framed, adjust]
  );

  const pipelineSource = useMemo<PipelineSource>(() => {
    if (adjusted) return { kind: 'cells', cells: adjusted };
    if (loadedGrid) {
      return { kind: 'grid', grid: loadedGrid.grid, colorKeys: loadedGrid.colorKeys };
    }
    return { kind: 'none' };
  }, [adjusted, loadedGrid]);

  const buildSettings = useMemo<BuildSettings>(
    () => ({
      orientation: mosaic.orientation,
      colorKeys: activeColors.map((c) => c.key),
      dither: quantizeSettings.dither,
      ditherStrength: quantizeSettings.ditherStrength,
      maxColors: quantizeSettings.maxColors,
      strict: quantizeSettings.strict,
      inventory: tiler.inventory,
      weights: tiler.weights,
      seed: tiler.seed,
      restarts: tiler.restarts,
      budgetMs: tiler.budgetMs,
    }),
    [mosaic.orientation, activeColors, quantizeSettings, tiler]
  );

  const pipeline = useMosaicPipeline(pipelineSource, buildSettings, state.autoRebuild);

  const derived = useMemo<DerivedMosaic>(() => {
    const size = finishedSize(mosaic.cols, mosaic.rows, mosaic.orientation);
    const baseplates = baseplatesFor(mosaic.cols, mosaic.rows);
    const tooLarge =
      mosaic.cols > WARN_GRID_DIMENSION || mosaic.rows > WARN_GRID_DIMENSION;
    const warnings = [...palette.warnings];
    if (pipeline.error) warnings.push(pipeline.error);

    const result = pipeline.result;
    if (!result) {
      return {
        activeColors,
        tiling: null,
        bom: null,
        gridColors: [],
        colorKeys: [],
        grid: null,
        counts: [],
        size,
        baseplates,
        warnings,
        tooLarge,
        elapsedMs: 0,
      };
    }

    const gridColors = result.colorKeys.map((key) => palette.byKey.get(key)!);
    const bom = buildBom(result.tiling, gridColors);
    warnings.push(...bom.warnings);

    return {
      activeColors,
      tiling: result.tiling,
      bom,
      gridColors,
      colorKeys: result.colorKeys,
      grid: result.grid,
      counts: result.counts,
      size,
      baseplates,
      warnings,
      tooLarge,
      elapsedMs: result.elapsedMs,
    };
  }, [pipeline.result, pipeline.error, activeColors, mosaic]);

  const setCrop = useCallback(
    (next: CropRect) => dispatch({ type: 'setCrop', crop: next }),
    []
  );

  return {
    state,
    dispatch,
    derived,
    busy: pipeline.busy,
    progress: pipeline.progress,
    usingWorker: pipeline.usingWorker,
    stale: pipeline.stale,
    rebuild: pipeline.rebuild,
    setCrop,
  };
}
