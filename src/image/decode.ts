/**
 * Browser-side image decoding.
 *
 * This is the only part of the pipeline that needs the DOM, so it lives
 * outside src/lego/ and stays deliberately thin: everything it can hand off
 * to a pure function, it does.
 */
import { pickDownscaleFactor } from '../lego/frame';
import type { SourceImage } from '../lego/types';

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg'] as const;

/** Beyond this, we ask before chewing through the pixels. */
export const LARGE_IMAGE_PIXELS = 40_000_000;

/**
 * Ceiling for the buffer handed to the box filter. Above this an integer
 * pre-shrink runs first — see DESIGN.md §6.2 for the quality tradeoff.
 */
export const DEFAULT_MAX_PIXELS = 8_000_000;

export class ImageDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ImageDecodeError';
  }
}

export function isAcceptedType(type: string): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(type);
}

export interface DecodeOptions {
  /** Pre-shrink above this many pixels. Defaults to `DEFAULT_MAX_PIXELS`. */
  maxPixels?: number;
}

export interface DecodedImage extends SourceImage {
  /** Source dimensions before any pre-shrink, for display and the project file. */
  naturalWidth: number;
  naturalHeight: number;
  /** Integer factor the image was shrunk by, 1 if untouched. */
  downscale: number;
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function decodeImageFile(
  file: File,
  options: DecodeOptions = {}
): Promise<DecodedImage> {
  if (!isAcceptedType(file.type)) {
    throw new ImageDecodeError(
      `Unsupported file type ${file.type || '(unknown)'} — expected PNG or JPEG`
    );
  }

  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: 'from-image'` is not optional. Without it every
    // portrait photo taken on a phone arrives rotated 90 degrees, which is the
    // most common "your app is broken" report for any image tool.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (cause) {
    // Keep the underlying failure attached; the surface message is for the
    // user, the cause is for whoever has to debug it.
    throw new ImageDecodeError(
      `Could not decode ${file.name || 'the image'} — it may be corrupt`,
      { cause }
    );
  }

  const naturalWidth = bitmap.width;
  const naturalHeight = bitmap.height;

  try {
    const downscale = pickDownscaleFactor(
      naturalWidth,
      naturalHeight,
      options.maxPixels ?? DEFAULT_MAX_PIXELS
    );
    const width = Math.max(1, Math.round(naturalWidth / downscale));
    const height = Math.max(1, Math.round(naturalHeight / downscale));

    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext('2d', {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new ImageDecodeError('Could not obtain a 2D canvas context');

    ctx.drawImage(bitmap, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    return {
      width,
      height,
      data: imageData.data,
      naturalWidth,
      naturalHeight,
      downscale,
    };
  } finally {
    bitmap.close();
  }
}
