/**
 * Browser-side image decoding.
 *
 * The only part of the pipeline that needs the DOM, so it lives outside
 * src/lego/ alongside the other platform adapters, and stays deliberately
 * thin: everything it can hand off to a pure function, it does.
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
  /** The original bytes, so a project can embed the image it started from. */
  dataUrl: string;
}

/** Read a File as a base64 data URL, for embedding in a project file. */
export function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageDecodeError('Could not read that file'));
    reader.readAsDataURL(file);
  });
}

/** Turn an embedded data URL back into a decodable File. */
export async function fileFromDataUrl(dataUrl: string, name: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

/** Fallback decode path for browsers without `createImageBitmap(Blob)`. */
async function decodeViaImageElement(file: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // Wrapped so callers see one type; `close()` is a no-op on the shim.
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => {},
      [Symbol.toStringTag]: 'ImageBitmap',
      __element: image,
    } as unknown as ImageBitmap;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
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
  } catch {
    // Older Safari has no createImageBitmap(Blob) at all. An <img> element
    // decodes anywhere and applies EXIF orientation itself, so the fallback
    // costs one extra copy and nothing else.
    try {
      bitmap = await decodeViaImageElement(file);
    } catch (cause) {
      // Keep the underlying failure attached; the surface message is for the
      // user, the cause is for whoever has to debug it.
      throw new ImageDecodeError(
        `Could not decode ${file.name || 'the image'} — it may be corrupt`,
        { cause }
      );
    }
  }

  const naturalWidth = bitmap.width;
  const naturalHeight = bitmap.height;
  const dataUrl = await readDataUrl(file);

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

    const drawable =
      (bitmap as unknown as { __element?: HTMLImageElement }).__element ?? bitmap;
    ctx.drawImage(drawable, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    return {
      width,
      height,
      data: imageData.data,
      naturalWidth,
      naturalHeight,
      downscale,
      dataUrl,
    };
  } finally {
    bitmap.close();
  }
}
