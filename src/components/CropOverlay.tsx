import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { clampCrop } from '../lego/frame';
import { cropAspect, withAspect } from '../state/useMosaicStore';
import type { CropRect } from '../lego/types';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Edge = 'n' | 'e' | 's' | 'w';
type Handle = Corner | Edge;

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const EDGES: Edge[] = ['n', 'e', 's', 'w'];

const isCorner = (h: Handle): h is Corner => h.length === 2;
const pullsLeft = (h: Handle) => h === 'nw' || h === 'sw' || h === 'w';
const pullsUp = (h: Handle) => h === 'nw' || h === 'ne' || h === 'n';
/** Edge handles move one axis; 'n'/'s' leave the width alone and vice versa. */
const movesX = (h: Handle) => h !== 'n' && h !== 's';
const movesY = (h: Handle) => h !== 'e' && h !== 'w';

export interface CropOverlayProps {
  crop: CropRect;
  onChange: (crop: CropRect) => void;
  /** Source dimensions, needed to reason about the physical aspect. */
  imageWidth: number;
  imageHeight: number;
  /** Physical width / height the crop must keep while `lockAspect` holds. */
  aspect: number;
  /**
   * Whether the grid's proportions constrain the crop. False when the crop is
   * the master and the brick counts follow it, which is the default — then a
   * drag is free in both axes and edge handles appear.
   */
  lockAspect: boolean;
}

const MIN_SPAN = 0.02;

/**
 * Draggable, resizable crop rectangle.
 *
 * Corner and edge drags anchor the opposite side, which is what makes the
 * interaction feel predictable. When `lockAspect` is set, resizing has only one
 * free dimension — the other follows the mosaic's *physical* proportions, and
 * the edge handles are withdrawn because they have nothing left to say.
 */
export default function CropOverlay({
  crop,
  onChange,
  imageWidth,
  imageHeight,
  aspect,
  lockAspect,
}: CropOverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    handle: Handle | 'move';
    startX: number;
    startY: number;
    start: CropRect;
  } | null>(null);

  /**
   * Zoom keeps whichever aspect is currently authoritative: the grid's when
   * locked, otherwise the crop's own, so scrolling never quietly reshapes a
   * frame the user placed by hand.
   */
  const shape = useCallback(
    (next: CropRect) =>
      withAspect(
        next,
        imageWidth,
        imageHeight,
        lockAspect ? aspect : cropAspect(crop, imageWidth, imageHeight)
      ),
    [imageWidth, imageHeight, aspect, lockAspect, crop]
  );

  const onPointerDown = (handle: Handle | 'move') => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Capture keeps the drag alive when the pointer leaves the handle. It can
    // legitimately fail (a pointer that is no longer active), and a throw here
    // would abort before the drag state is set, killing dragging entirely.
    try {
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {
      /* dragging still works via the frame's own move handler */
    }
    drag.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      start: crop,
    };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const state = drag.current;
    const frame = frameRef.current;
    if (!state || !frame) return;

    const box = frame.getBoundingClientRect();
    const dx = (event.clientX - state.startX) / box.width;
    const dy = (event.clientY - state.startY) / box.height;
    const { start, handle } = state;

    if (handle === 'move') {
      onChange(clampCrop({ ...start, x: start.x + dx, y: start.y + dy }));
      return;
    }

    // Resize, anchoring the opposite corner or edge.
    const left = pullsLeft(handle);
    const up = pullsUp(handle);
    const anchorX = left ? start.x + start.w : start.x;
    const anchorY = up ? start.y + start.h : start.y;

    let w = movesX(handle)
      ? Math.max(MIN_SPAN, left ? start.w - dx : start.w + dx)
      : start.w;
    let h = movesY(handle)
      ? Math.max(MIN_SPAN, up ? start.h - dy : start.h + dy)
      : start.h;

    if (lockAspect) {
      // One free dimension only: take the width from the pointer and derive the
      // height, so the aspect cannot drift over a long drag.
      const sized = withAspect({ x: 0, y: 0, w, h }, imageWidth, imageHeight, aspect);
      w = sized.w;
      h = sized.h;
    }

    onChange(
      clampCrop({ x: left ? anchorX - w : anchorX, y: up ? anchorY - h : anchorY, w, h })
    );
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    if ((event.target as Element).hasPointerCapture?.(event.pointerId)) {
      (event.target as Element).releasePointerCapture(event.pointerId);
    }
    drag.current = null;
  };

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.06 : 1 / 1.06;
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;
    const sized = shape({
      x: 0,
      y: 0,
      w: Math.min(1, Math.max(MIN_SPAN, crop.w * factor)),
      h: 1,
    });
    onChange(
      clampCrop({ x: cx - sized.w / 2, y: cy - sized.h / 2, w: sized.w, h: sized.h })
    );
  };

  /** Arrow keys nudge, +/- zoom — the crop must be reachable without a mouse. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      onChange(clampCrop({ ...crop, x: crop.x + move[0], y: crop.y + move[1] }));
      return;
    }
    if (event.key === '+' || event.key === '-' || event.key === '=') {
      event.preventDefault();
      const factor = event.key === '-' ? 1.08 : 1 / 1.08;
      const cx = crop.x + crop.w / 2;
      const cy = crop.y + crop.h / 2;
      const sized = shape({
        x: 0,
        y: 0,
        w: Math.min(1, Math.max(MIN_SPAN, crop.w * factor)),
        h: 1,
      });
      onChange(
        clampCrop({ x: cx - sized.w / 2, y: cy - sized.h / 2, w: sized.w, h: sized.h })
      );
    }
  };

  const style = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.w * 100}%`,
    height: `${crop.h * 100}%`,
  };

  return (
    <div
      ref={frameRef}
      className="crop-frame"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <div
        className="crop-rect"
        style={style}
        role="slider"
        tabIndex={0}
        aria-label="Crop region. Arrow keys move, plus and minus zoom."
        aria-valuetext={`${Math.round(crop.w * 100)}% wide, ${Math.round(crop.h * 100)}% tall, positioned ${Math.round(crop.x * 100)}% from the left and ${Math.round(crop.y * 100)}% from the top`}
        onPointerDown={onPointerDown('move')}
        onKeyDown={onKeyDown}
      >
        {(lockAspect ? CORNERS : [...CORNERS, ...EDGES]).map((handle) => (
          <span
            key={handle}
            className={`crop-handle crop-handle--${handle}${
              isCorner(handle) ? '' : ' crop-handle--edge'
            }`}
            onPointerDown={onPointerDown(handle)}
          />
        ))}
      </div>
    </div>
  );
}
