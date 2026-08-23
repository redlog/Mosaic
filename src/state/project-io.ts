/**
 * Turning application state into a project file and back.
 *
 * Kept out of the reducer so the shape of the saved document is a single,
 * readable mapping rather than something scattered across action handlers.
 */
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectError,
  encodeRle,
  readGrid,
  type ProjectFile,
} from '../lego/project';
import { fileFromDataUrl, decodeImageFile } from '../browser/decode';
import { initialState, type MosaicState } from './useMosaicStore';
import type { Grid } from '../lego/types';

export const APP_VERSION = '0.1.0';

export interface SaveOptions {
  /**
   * Embed the source image. Self-contained and fully re-editable, at the cost
   * of turning a large photo into a large JSON file.
   */
  embedSource: boolean;
}

export function toProject(
  state: MosaicState,
  grid: Grid,
  colorKeys: readonly string[],
  options: SaveOptions
): ProjectFile {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    createdAt: new Date().toISOString(),
    app: { version: APP_VERSION },
    crop: state.crop,
    transform: state.transform,
    mosaic: {
      orientation: state.mosaic.orientation,
      cols: state.mosaic.cols,
      rows: state.mosaic.rows,
      linkAspect: state.mosaic.linkAspect,
    },
    adjust: state.adjust,
    quantize: {
      dither: state.quantizeSettings.dither,
      ditherStrength: state.quantizeSettings.ditherStrength,
      maxColors: state.quantizeSettings.maxColors,
      strictAvailability: state.quantizeSettings.strict,
      enabledColors: [...state.quantizeSettings.enabledColors],
    },
    tiler: {
      inventory: [...state.tiler.inventory],
      weights: state.tiler.weights,
      restarts: state.tiler.restarts,
      seed: state.tiler.seed,
    },
    palette: { id: 'builtin-v1', overrides: [] },
    // The tiling is deliberately absent: it is recomputed from this grid plus
    // the settings and seed above, so it cannot disagree with them.
    grid: {
      cols: grid.cols,
      rows: grid.rows,
      encoding: 'rle-v1',
      colorKeys: [...colorKeys],
      data: encodeRle(grid.colors),
    },
  };

  if (state.source) {
    file.source = {
      name: state.source.name,
      width: state.source.naturalWidth,
      height: state.source.naturalHeight,
      ...(options.embedSource ? { dataUrl: state.source.dataUrl } : {}),
    };
  }

  return file;
}

/**
 * Rebuild state from a project. When the image was embedded the result is
 * fully editable; otherwise the stored grid stands in and re-cropping and
 * re-quantizing are unavailable.
 */
export async function fromProject(
  file: ProjectFile,
  projectName: string
): Promise<MosaicState> {
  const base = initialState();
  const restored = readGrid(file);

  const next: MosaicState = {
    ...base,
    projectName,
    crop: file.crop,
    transform: file.transform,
    mosaic: {
      orientation: file.mosaic.orientation,
      cols: file.mosaic.cols,
      rows: file.mosaic.rows,
      linkAspect: file.mosaic.linkAspect,
    },
    adjust: file.adjust,
    quantizeSettings: {
      dither: file.quantize.dither,
      ditherStrength: file.quantize.ditherStrength,
      maxColors: file.quantize.maxColors,
      strict: file.quantize.strictAvailability,
      enabledColors: [...file.quantize.enabledColors],
    },
    tiler: {
      ...base.tiler,
      inventory: [...file.tiler.inventory],
      weights: file.tiler.weights,
      restarts: file.tiler.restarts,
      seed: file.tiler.seed,
    },
    loadedGrid: restored,
    source: null,
  };

  const dataUrl = file.source?.dataUrl;
  if (!dataUrl) return next;

  try {
    const decoded = await decodeImageFile(
      await fileFromDataUrl(dataUrl, file.source?.name ?? 'image')
    );
    return {
      ...next,
      loadedGrid: null,
      source: {
        name: file.source?.name ?? 'image',
        image: { width: decoded.width, height: decoded.height, data: decoded.data },
        naturalWidth: decoded.naturalWidth,
        naturalHeight: decoded.naturalHeight,
        dataUrl,
      },
    };
  } catch (cause) {
    // The grid is still good, so open read-only rather than failing outright.
    throw new ProjectError(
      `The project opened, but its embedded image could not be decoded: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
  }
}
