/**
 * The whole application state, and the derived pipeline hanging off it.
 *
 * Each pipeline stage is memoized on its own inputs, so changing a tiler
 * weight does not re-decode the image and moving the crop does not re-run
 * palette selection (DESIGN.md §6).
 */
import { useCallback, useDeferredValue, useMemo, useReducer } from 'react';
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
  finishedSize,
} from '../lego/constants';
import {
  enabledColors as selectColors,
  loadPalette,
  unusableColors,
} from '../lego/palette';
import { defaultInventoryFor } from '../lego/parts';
import { quantize, type DitherMode } from '../lego/quantize';
import { DEFAULT_WALL_WEIGHTS, DEFAULT_WEIGHTS } from '../lego/score';
import { tile } from '../lego/tile';
import { randomSeed } from '../lego/rng';
import type { RenderMode } from '../lego/render';
import type {
  Adjustments,
  CropRect,
  LegoColor,
  Orientation,
  SourceImage,
  TilerWeights,
  Tiling,
  Transform,
} from '../lego/types';

export const palette = loadPalette();
const allColors = [...palette.colors];

/** The 1x1 is mandatory: without it some regions cannot be covered at all. */
export const REQUIRED_SHAPE = '3005';

/**
 * Interactive tiling runs on the main thread until Phase 7 moves it into a
 * worker, so the live budget is deliberately short. Exports can afford more.
 */
export const INTERACTIVE_BUDGET_MS = 400;
export const INTERACTIVE_RESTARTS = 60;

export interface SourceState {
  name: string;
  image: SourceImage;
  naturalWidth: number;
  naturalHeight: number;
}

export interface MosaicSettings {
  orientation: Orientation;
  cols: number;
  rows: number;
  /** Keep the grid proportioned to the crop when one dimension changes. */
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
  crop: CropRect;
  transform: Transform;
  mosaic: MosaicSettings;
  adjust: Adjustments;
  quantizeSettings: QuantizeSettings;
  tiler: TilerSettings;
  view: ViewSettings;
  error: string | null;
}

export function initialState(): MosaicState {
  return {
    source: null,
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
      restarts: INTERACTIVE_RESTARTS,
      budgetMs: INTERACTIVE_BUDGET_MS,
      seed: 1,
    },
    view: { mode: 'build', pxPerStud: 14 },
    error: null,
  };
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Reshape a crop to a target physical aspect, keeping its centre and staying
 * inside the image. Called whenever the grid or orientation changes, because
 * the crop's shape is a function of the mosaic's shape, not the other way
 * round (DESIGN.md §2.4a).
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
  | { type: 'setError'; error: string | null }
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
      const next: MosaicState = { ...state, source: action.source, error: null };
      const aspect = cropAspectFor(
        state.mosaic.cols,
        state.mosaic.rows,
        state.mosaic.orientation
      );
      next.crop = centerCropForAspect(
        action.source.naturalWidth,
        action.source.naturalHeight,
        aspect
      );
      return next;
    }

    case 'clearSource':
      return { ...initialState(), view: state.view };

    case 'setCrop':
      return { ...state, crop: clampCrop(action.crop) };

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

      // When the aspect is linked, the *other* dimension follows the crop.
      if (state.mosaic.linkAspect && state.source) {
        const cropAspect =
          (state.crop.w * state.source.naturalWidth) /
          (state.crop.h * state.source.naturalHeight);
        const cellRatio = mosaic.orientation === 'pips-up' ? 9.6 / 8 : 1;
        // mosaicAspect = cols / (rows * cellRatio); solve for the other side.
        if (action.patch.cols !== undefined) {
          mosaic.rows = clamp(
            Math.round(mosaic.cols / (cropAspect * cellRatio)),
            MIN_GRID_DIMENSION,
            MAX_GRID_DIMENSION
          );
        } else if (action.patch.rows !== undefined) {
          mosaic.cols = clamp(
            Math.round(mosaic.rows * cropAspect * cellRatio),
            MIN_GRID_DIMENSION,
            MAX_GRID_DIMENSION
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

    case 'replace':
      return action.state;
  }
}

export interface DerivedMosaic {
  /** Colors actually offered to the quantizer. */
  activeColors: LegoColor[];
  tiling: Tiling | null;
  bom: Bom | null;
  /** Cell colors, parallel to the tiling's indices. */
  gridColors: LegoColor[];
  counts: number[];
  size: ReturnType<typeof finishedSize>;
  baseplates: ReturnType<typeof baseplatesFor>;
  warnings: string[];
  tooLarge: boolean;
  elapsedMs: number;
}

export function useMosaicStore() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  /**
   * Deferring the heavy inputs keeps typing in a number field responsive:
   * React renders the control immediately and recomputes the mosaic on a
   * lower-priority pass. Phase 7 moves the work off the thread entirely.
   */
  const deferred = useDeferredValue(state);
  const busy = deferred !== state;

  const { source, crop, transform, mosaic, adjust, quantizeSettings, tiler } = deferred;

  const activeColors = useMemo(() => {
    const enabled = selectColors(palette, quantizeSettings.enabledColors);
    if (!quantizeSettings.strict) return enabled;
    const unusable = new Set(unusableColors(enabled, tiler.inventory).map((c) => c.key));
    const usable = enabled.filter((c) => !unusable.has(c.key));
    return usable.length > 0 ? usable : enabled;
  }, [quantizeSettings.enabledColors, quantizeSettings.strict, tiler.inventory]);

  const framed = useMemo(() => {
    if (!source) return null;
    return frameImage(source.image, mosaic.cols, mosaic.rows, { crop, transform });
  }, [source, mosaic.cols, mosaic.rows, crop, transform]);

  const adjusted = useMemo(
    () => (framed ? applyAdjustments(framed, adjust) : null),
    [framed, adjust]
  );

  const quantized = useMemo(() => {
    if (!adjusted) return null;
    return quantize(adjusted, activeColors, {
      dither: quantizeSettings.dither,
      ditherStrength: quantizeSettings.ditherStrength,
      maxColors: quantizeSettings.maxColors,
    });
  }, [
    adjusted,
    activeColors,
    quantizeSettings.dither,
    quantizeSettings.ditherStrength,
    quantizeSettings.maxColors,
  ]);

  const derived = useMemo<DerivedMosaic>(() => {
    const size = finishedSize(mosaic.cols, mosaic.rows, mosaic.orientation);
    const baseplates = baseplatesFor(mosaic.cols, mosaic.rows);
    const tooLarge =
      mosaic.cols > WARN_GRID_DIMENSION || mosaic.rows > WARN_GRID_DIMENSION;
    const warnings = [...palette.warnings];

    if (!quantized) {
      return {
        activeColors,
        tiling: null,
        bom: null,
        gridColors: [],
        counts: [],
        size,
        baseplates,
        warnings,
        tooLarge,
        elapsedMs: 0,
      };
    }

    const started = performance.now();
    let tiling: Tiling | null = null;
    try {
      tiling = tile(quantized.grid, mosaic.orientation, {
        inventory: tiler.inventory,
        weights: tiler.weights,
        seed: tiler.seed,
        restarts: tiler.restarts,
        budgetMs: tiler.budgetMs,
        strict: quantizeSettings.strict,
        colors: quantized.colors,
      });
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }

    const bom = tiling ? buildBom(tiling, quantized.colors) : null;
    if (bom) warnings.push(...bom.warnings);

    return {
      activeColors,
      tiling,
      bom,
      gridColors: quantized.colors,
      counts: quantized.counts,
      size,
      baseplates,
      warnings,
      tooLarge,
      elapsedMs: performance.now() - started,
    };
  }, [
    quantized,
    activeColors,
    mosaic.cols,
    mosaic.rows,
    mosaic.orientation,
    tiler.inventory,
    tiler.weights,
    tiler.seed,
    tiler.restarts,
    tiler.budgetMs,
    quantizeSettings.strict,
  ]);

  const setCrop = useCallback(
    (next: CropRect) => dispatch({ type: 'setCrop', crop: next }),
    []
  );

  return { state, dispatch, derived, busy, setCrop };
}
