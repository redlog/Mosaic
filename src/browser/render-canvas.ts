/**
 * Canvas ownership for the renderer. The drawing itself lives in
 * src/lego/render.ts; this only creates a surface and hands back a bitmap.
 */
import { drawMosaic, renderGeometry, type RenderOptions } from '../lego/render';
import type { LegoColor, Tiling } from '../lego/types';

export const PNG_MIME = 'image/png';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Draw a tiling onto a freshly sized canvas. */
export function renderToCanvas(
  tiling: Tiling,
  colors: readonly LegoColor[],
  options: RenderOptions = {}
): AnyCanvas {
  const geometry = renderGeometry(tiling, options);
  const canvas = createCanvas(geometry.width, geometry.height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Could not obtain a 2D canvas context');
  drawMosaic(ctx, tiling, colors, options);
  return canvas;
}

/** Draw onto an existing canvas, resizing it to fit. For the live preview. */
export function renderInto(
  canvas: HTMLCanvasElement,
  tiling: Tiling,
  colors: readonly LegoColor[],
  options: RenderOptions = {}
): void {
  const geometry = renderGeometry(tiling, options);
  if (canvas.width !== geometry.width) canvas.width = geometry.width;
  if (canvas.height !== geometry.height) canvas.height = geometry.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not obtain a 2D canvas context');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMosaic(ctx, tiling, colors, options);
}

export async function renderToBlob(
  tiling: Tiling,
  colors: readonly LegoColor[],
  options: RenderOptions = {}
): Promise<Blob> {
  const canvas = renderToCanvas(tiling, colors, options);

  if ('convertToBlob' in canvas) {
    return await canvas.convertToBlob({ type: PNG_MIME });
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas produced no image data'));
    }, PNG_MIME);
  });
}
