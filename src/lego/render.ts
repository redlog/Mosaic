/**
 * Render a tiling as bricks.
 *
 * This module draws to a *context*, never to a canvas it owns, which keeps it
 * free of the DOM and testable against a recording stub. `src/browser/
 * render-canvas.ts` supplies a real canvas.
 *
 * Two views, answering different questions:
 *
 * - **build** shows construction — every brick outlined, studs drawn laid
 *   flat, course seams drawn in a wall. This is what you follow while building.
 * - **clean** shows the result — flat color, no seams. This is what the mosaic
 *   looks like from across the room, and it is the honest answer to "do I like
 *   it?".
 */
import { cellSize } from './constants';
import { darkenLab, rgbToHex } from './color';
import type { LegoColor, Tiling } from './types';

export type RenderMode = 'build' | 'clean';

export interface RenderOptions {
  /** Pixels per stud along the horizontal axis. */
  pxPerStud?: number;
  mode?: RenderMode;
  /** CSS color painted behind the mosaic. */
  background?: string;
  /** Border in CSS pixels, before scaling. */
  padding?: number;
  /** Export multiplier. Drawing code stays scale-free; the context is scaled. */
  scale?: number;
  /** Force studs on or off. Defaults to on in build mode when big enough to see. */
  showStuds?: boolean;
}

export interface RenderGeometry {
  /** Cell size in CSS pixels. Taller than wide in a wall — the real 5:6. */
  cellW: number;
  cellH: number;
  /** Mosaic size in CSS pixels, excluding padding. */
  contentWidth: number;
  contentHeight: number;
  padding: number;
  scale: number;
  /** Final bitmap size in device pixels, including padding and scale. */
  width: number;
  height: number;
}

export const DEFAULT_PX_PER_STUD = 24;

/** Below this, a stud is a smudge; drawing it costs time and adds noise. */
export const MIN_STUD_PX = 6;

export function renderGeometry(
  tiling: Pick<Tiling, 'cols' | 'rows' | 'orientation'>,
  options: RenderOptions = {}
): RenderGeometry {
  const pxPerStud = options.pxPerStud ?? DEFAULT_PX_PER_STUD;
  const scale = options.scale ?? 1;
  const padding = options.padding ?? 0;

  // Cell aspect comes from real brick geometry, so the preview is
  // dimensionally honest rather than merely square.
  const cell = cellSize(tiling.orientation);
  const cellW = pxPerStud;
  const cellH = pxPerStud * (cell.h / cell.w);

  const contentWidth = Math.round(tiling.cols * cellW);
  const contentHeight = Math.round(tiling.rows * cellH);

  return {
    cellW,
    cellH,
    contentWidth,
    contentHeight,
    padding,
    scale,
    width: Math.round((contentWidth + padding * 2) * scale),
    height: Math.round((contentHeight + padding * 2) * scale),
  };
}

/**
 * The subset of the 2D canvas API this module uses.
 *
 * `CanvasRenderingContext2D` and `OffscreenCanvasRenderingContext2D` both
 * satisfy it structurally, and a recording stub in the tests satisfies it too.
 */
export interface Ctx2D {
  // Typed as the real API's union rather than plain `string`, or a genuine
  // CanvasRenderingContext2D would not satisfy this interface. These are
  // type-only references and erase at runtime, so the module still runs in
  // Node. Only strings are ever assigned.
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  roundRect?(x: number, y: number, w: number, h: number, radii: number): void;
}

/** Per-color CSS strings, resolved once rather than per brick. */
interface Palette {
  fill: string[];
  edge: string[];
  seam: string[];
  studRing: string[];
}

function preparePalette(colors: readonly LegoColor[]): Palette {
  const fill: string[] = [];
  const edge: string[] = [];
  const seam: string[] = [];
  const studRing: string[] = [];
  for (const color of colors) {
    fill.push(rgbToHex(color.rgb));
    edge.push(rgbToHex(darkenLab(color.rgb, 0.35)));
    seam.push(rgbToHex(darkenLab(color.rgb, 0.22)));
    studRing.push(rgbToHex(darkenLab(color.rgb, 0.18)));
  }
  return { fill, edge, seam, studRing };
}

const HIGHLIGHT = 'rgba(255,255,255,0.22)';
const SHADOW = 'rgba(0,0,0,0.18)';
const EDGE_HIGHLIGHT = 'rgba(255,255,255,0.10)';
const EDGE_SHADOW = 'rgba(0,0,0,0.12)';

/**
 * Draw the mosaic. Returns the geometry it used, so callers can size a canvas
 * without recomputing.
 *
 * Cell edges are snapped to whole pixels rather than the cell *size* being
 * rounded. In a wall a cell is 1.2 studs tall, so at 24px per stud it is 28.8px
 * — rounding the size would drift by a pixel every few courses and either open
 * hairline gaps or overlap neighbours. Snapping shared edges instead keeps the
 * tiling exact and the overall aspect right.
 */
export function drawMosaic(
  ctx: Ctx2D,
  tiling: Tiling,
  colors: readonly LegoColor[],
  options: RenderOptions = {}
): RenderGeometry {
  const geometry = renderGeometry(tiling, options);
  const { cellW, cellH, padding, scale } = geometry;
  const mode = options.mode ?? 'build';
  const build = mode === 'build';
  const wall = tiling.orientation === 'pips-up';
  const studs = options.showStuds ?? (build && !wall && cellW >= MIN_STUD_PX);

  const palette = preparePalette(colors);
  const edgeX = (col: number): number => padding + Math.round(col * cellW);
  const edgeY = (row: number): number => padding + Math.round(row * cellH);

  ctx.save();
  if (scale !== 1) ctx.scale(scale, scale);

  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(
      0,
      0,
      geometry.contentWidth + padding * 2,
      geometry.contentHeight + padding * 2
    );
  }

  const radius = build && !wall ? Math.max(1, cellW * 0.12) : 0;
  const strokeWidth = Math.max(1, cellW * 0.05);

  for (const placement of tiling.placements) {
    const fill = palette.fill[placement.colorIdx];
    if (fill === undefined) {
      throw new Error(
        `Placement references color index ${placement.colorIdx}, which is not in the palette`
      );
    }

    const x0 = edgeX(placement.col);
    const y0 = edgeY(placement.row);
    const x1 = edgeX(placement.col + placement.w);
    const y1 = edgeY(placement.row + placement.h);
    const w = x1 - x0;
    const h = y1 - y0;

    ctx.fillStyle = fill;

    // The body is always a full rectangle, never a rounded fill. Bricks butt
    // flush against each other in reality, and filling a rounded path leaves
    // the background showing through as white pinholes wherever four brick
    // corners meet — which, on a mosaic, is everywhere. The rounding is added
    // afterwards as a stroke *inside* the filled area instead.
    ctx.fillRect(x0, y0, w, h);

    if (!build) continue;

    if (radius > 0 && ctx.roundRect) {
      const inset = strokeWidth / 2;
      ctx.beginPath();
      ctx.roundRect(x0 + inset, y0 + inset, w - strokeWidth, h - strokeWidth, radius);
      ctx.strokeStyle = palette.edge[placement.colorIdx]!;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }

    if (wall) {
      // A stud-up wall viewed head-on shows no studs at all — which is exactly
      // why this orientation reads as smooth. What it does show is the mortar:
      // a highlight along each course's top edge, shadow along the bottom, and
      // a vertical seam where two bricks in a course meet.
      ctx.fillStyle = EDGE_HIGHLIGHT;
      ctx.fillRect(x0, y0, w, 1);
      ctx.fillStyle = EDGE_SHADOW;
      ctx.fillRect(x0, y1 - 1, w, 1);
      if (placement.col + placement.w < tiling.cols) {
        ctx.fillStyle = palette.seam[placement.colorIdx]!;
        ctx.fillRect(x1 - 1, y0, 1, h);
      }
      continue;
    }

    if (studs) {
      const studRadius = cellW * 0.3;
      ctx.lineWidth = Math.max(1, cellW * 0.04);
      for (let r = 0; r < placement.h; r++) {
        for (let c = 0; c < placement.w; c++) {
          const cx = edgeX(placement.col + c) + cellW / 2;
          const cy = edgeY(placement.row + r) + cellH / 2;

          ctx.beginPath();
          ctx.arc(cx, cy, studRadius, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = palette.studRing[placement.colorIdx]!;
          ctx.stroke();

          // Light from the top left, so the studs read as raised rather than
          // as flat discs.
          ctx.beginPath();
          ctx.arc(cx, cy, studRadius, Math.PI, Math.PI * 1.5);
          ctx.strokeStyle = HIGHLIGHT;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(cx, cy, studRadius, 0, Math.PI * 0.5);
          ctx.strokeStyle = SHADOW;
          ctx.stroke();
        }
      }
    }
  }

  ctx.restore();
  return geometry;
}
