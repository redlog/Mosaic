import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { clampCrop } from '../lego/frame';
import { withAspect } from '../state/useMosaicStore';
import type { CropRect } from '../lego/types';

type Handle = 'nw' | 'ne' | 'sw' | 'se';
const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se'];

export interface CropOverlayProps {
  crop: CropRect;
  onChange: (crop: CropRect) => void;
  /** Source dimensions, needed to hold the physical aspect. */
  imageWidth: number;
  imageHeight: number;
  /** Physical width / height the crop must keep. */
  aspect: number;
}

const MIN_SPAN = 0.02;

/**
 * Draggable, resizable crop rectangle.
 *
 * The aspect is locked to the mosaic's *physical* proportions, so resizing
 * only ever has one free dimension — the other follows. Corner drags anchor
 * the opposite corner, which is what makes the interaction feel predictable.
 */
export default function CropOverlay({
  crop,
  onChange,
  imageWidth,
  imageHeight,
  aspect,
}: CropOverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    handle: Handle | 'move';
    startX: number;
    startY: number;
    start: CropRect;
  } | null>(null);

  const shape = useCallback(
    (next: CropRect) => withAspect(next, imageWidth, imageHeight, aspect),
    [imageWidth, imageHeight, aspect]
  );

  const onPointerDown = (handle: Handle | 'move') => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
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

    // Resize from a corner, anchoring the one diagonally opposite. Only the
    // width is taken from the pointer; the height is derived, so the aspect
    // cannot drift.
    const anchorX = handle === 'nw' || handle === 'sw' ? start.x + start.w : start.x;
    const anchorY = handle === 'nw' || handle === 'ne' ? start.y + start.h : start.y;
    const pullingLeft = handle === 'nw' || handle === 'sw';

    const width = Math.max(MIN_SPAN, pullingLeft ? start.w - dx : start.w + dx);
    const sized = shape({ x: 0, y: 0, w: width, h: width });

    const x = pullingLeft ? anchorX - sized.w : anchorX;
    const y = handle === 'nw' || handle === 'ne' ? anchorY - sized.h : anchorY;

    onChange(clampCrop({ x, y, w: sized.w, h: sized.h }));
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
        {HANDLES.map((handle) => (
          <span
            key={handle}
            className={`crop-handle crop-handle--${handle}`}
            onPointerDown={onPointerDown(handle)}
          />
        ))}
      </div>
    </div>
  );
}
