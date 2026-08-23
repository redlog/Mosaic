/**
 * Framing: crop, orient, and downsample a source image to the brick grid.
 *
 * Pure — takes decoded pixels, returns cell averages. Browser decoding lives
 * in src/image/decode.ts so this stays testable in Node.
 *
 * The downsample is an area-weighted box filter evaluated in **linear light**.
 * Averaging gamma-encoded sRGB values is the single most common bug in image
 * mosaic tools: it makes every result muddy and dark, because a 50/50 mix of
 * black and white comes out at sRGB 128 instead of the correct 188.
 */
import { srgbToLinear, type Rgb } from './color';
import { mosaicAspect } from './constants';
import type {
  CellBuffer,
  CropRect,
  Orientation,
  Rotation,
  SourceImage,
  Transform,
} from './types';

/** sRGB byte to linear light. 256 entries, so the inner loop never calls pow. */
const SRGB_LUT: Float64Array = (() => {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  return lut;
})();

export const IDENTITY_TRANSFORM: Transform = {
  rotate: 0,
  flipH: false,
  flipV: false,
};

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Confine a crop to the image, keeping it non-degenerate. */
export function clampCrop(crop: CropRect): CropRect {
  const w = clamp01(crop.w);
  const h = clamp01(crop.h);
  const x = clamp01(Math.min(crop.x, 1 - w));
  const y = clamp01(Math.min(crop.y, 1 - h));
  return { x, y, w: Math.max(w, Number.EPSILON), h: Math.max(h, Number.EPSILON) };
}

/**
 * Aspect ratio the crop must hold for this grid, as width / height.
 *
 * Note this is the *physical* aspect, not `cols / rows`. In `pips-up` a cell
 * is 8mm x 9.6mm, so a square grid needs a 5:6 crop or the picture comes out
 * vertically squashed (DESIGN.md §2.4a).
 */
export function cropAspectFor(
  cols: number,
  rows: number,
  orientation: Orientation
): number {
  return mosaicAspect(cols, rows, orientation);
}

/** Dimensions after rotation. 90 and 270 swap the axes. */
export function transformedSize(
  width: number,
  height: number,
  rotate: Rotation
): { width: number; height: number } {
  return rotate === 90 || rotate === 270
    ? { width: height, height: width }
    : { width, height };
}

/**
 * The largest centered crop of the given aspect that fits the image — the
 * "cover" framing, cropping the long axis rather than letterboxing.
 */
export function centerCropForAspect(
  imageWidth: number,
  imageHeight: number,
  aspect: number
): CropRect {
  const imageAspect = imageWidth / imageHeight;
  if (imageAspect > aspect) {
    // Image is wider than wanted: full height, trim the sides.
    const w = aspect / imageAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = imageAspect / aspect;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/**
 * Integer factor to pre-shrink an oversized image by before box-filtering.
 *
 * A full JS pass over a 40-megapixel photo to produce a 48x48 grid is wasted
 * work; shrinking by an integer factor first and doing the remainder correctly
 * keeps nearly all the quality (DESIGN.md §6.2).
 */
export function pickDownscaleFactor(
  width: number,
  height: number,
  maxPixels: number
): number {
  const pixels = width * height;
  if (pixels <= maxPixels || maxPixels <= 0) return 1;
  return Math.ceil(Math.sqrt(pixels / maxPixels));
}

/**
 * Maps a coordinate in transformed space back to a byte offset in the source.
 * Folding the transform into sampling avoids materializing a rotated copy of
 * a potentially huge image.
 */
function makeSampler(
  source: SourceImage,
  transform: Transform
): (fx: number, fy: number) => number {
  const { width: W, height: H } = source;
  const { width: TW, height: TH } = transformedSize(W, H, transform.rotate);
  const { rotate, flipH, flipV } = transform;

  return (fx, fy) => {
    const tx = flipH ? TW - 1 - fx : fx;
    const ty = flipV ? TH - 1 - fy : fy;
    let x: number;
    let y: number;
    switch (rotate) {
      case 90:
        x = ty;
        y = H - 1 - tx;
        break;
      case 180:
        x = W - 1 - tx;
        y = H - 1 - ty;
        break;
      case 270:
        x = W - 1 - ty;
        y = tx;
        break;
      default:
        x = tx;
        y = ty;
    }
    return (y * W + x) * 4;
  };
}

export interface FrameOptions {
  crop?: CropRect;
  transform?: Transform;
  /**
   * Color that transparency is composited over, as 0-255 sRGB.
   * Defaults to white.
   */
  background?: Rgb;
}

/**
 * Crop, orient, and box-filter a source image down to `cols` x `rows` cells of
 * linear-light RGB.
 *
 * Cell boundaries land on fractional pixel positions, so each source pixel is
 * weighted by how much of it the cell actually covers. This handles both
 * downscaling and upscaling, and avoids the shimmer that nearest-neighbour
 * sampling produces on fine detail.
 */
export function frameImage(
  source: SourceImage,
  cols: number,
  rows: number,
  options: FrameOptions = {}
): CellBuffer {
  if (cols < 1 || rows < 1) {
    throw new Error(`Grid must be at least 1x1, got ${cols}x${rows}`);
  }
  if (source.width < 1 || source.height < 1) {
    throw new Error('Source image is empty');
  }
  if (source.data.length < source.width * source.height * 4) {
    throw new Error('Source image data is shorter than its dimensions imply');
  }

  const transform = options.transform ?? IDENTITY_TRANSFORM;
  const crop = clampCrop(options.crop ?? FULL_CROP);
  const bg = options.background ?? ([255, 255, 255] as const);
  const bgR = SRGB_LUT[bg[0]]!;
  const bgG = SRGB_LUT[bg[1]]!;
  const bgB = SRGB_LUT[bg[2]]!;

  const { width: TW, height: TH } = transformedSize(
    source.width,
    source.height,
    transform.rotate
  );
  const sample = makeSampler(source, transform);
  const px = source.data;

  const originX = crop.x * TW;
  const originY = crop.y * TH;
  const spanX = crop.w * TW;
  const spanY = crop.h * TH;

  const out = new Float32Array(cols * rows * 3);

  for (let row = 0; row < rows; row++) {
    const y0 = originY + (row * spanY) / rows;
    const y1 = originY + ((row + 1) * spanY) / rows;
    const pyStart = Math.max(0, Math.floor(y0));
    const pyEnd = Math.min(TH, Math.ceil(y1));

    for (let col = 0; col < cols; col++) {
      const x0 = originX + (col * spanX) / cols;
      const x1 = originX + ((col + 1) * spanX) / cols;
      const pxStart = Math.max(0, Math.floor(x0));
      const pxEnd = Math.min(TW, Math.ceil(x1));

      let r = 0;
      let g = 0;
      let b = 0;
      let total = 0;

      for (let py = pyStart; py < pyEnd; py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        if (wy <= 0) continue;
        for (let cx = pxStart; cx < pxEnd; cx++) {
          const wx = Math.min(x1, cx + 1) - Math.max(x0, cx);
          if (wx <= 0) continue;
          const weight = wx * wy;

          const i = sample(cx, py);
          const alpha = px[i + 3]! / 255;
          if (alpha >= 1) {
            r += SRGB_LUT[px[i]!]! * weight;
            g += SRGB_LUT[px[i + 1]!]! * weight;
            b += SRGB_LUT[px[i + 2]!]! * weight;
          } else {
            // Composite in linear light, same as everything else here.
            const inv = 1 - alpha;
            r += (SRGB_LUT[px[i]!]! * alpha + bgR * inv) * weight;
            g += (SRGB_LUT[px[i + 1]!]! * alpha + bgG * inv) * weight;
            b += (SRGB_LUT[px[i + 2]!]! * alpha + bgB * inv) * weight;
          }
          total += weight;
        }
      }

      const o = (row * cols + col) * 3;
      if (total > 0) {
        out[o] = r / total;
        out[o + 1] = g / total;
        out[o + 2] = b / total;
      } else {
        // Degenerate cell (a crop thinner than a pixel edge); fall back to the
        // nearest source pixel rather than emitting a black hole.
        const i = sample(
          Math.min(TW - 1, Math.max(0, Math.floor(x0))),
          Math.min(TH - 1, Math.max(0, Math.floor(y0)))
        );
        out[o] = SRGB_LUT[px[i]!]!;
        out[o + 1] = SRGB_LUT[px[i + 1]!]!;
        out[o + 2] = SRGB_LUT[px[i + 2]!]!;
      }
    }
  }

  return { cols, rows, data: out };
}
