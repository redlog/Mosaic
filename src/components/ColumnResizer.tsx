import { useRef } from 'react';

export interface ColumnResizerProps {
  label: string;
  /** Called with the pointer's horizontal movement in pixels since the last call. */
  onDrag: (deltaPx: number) => void;
}

/**
 * A draggable divider between two `.app__columns` panels. Pointer capture
 * keeps the drag going even if the cursor leaves the thin handle, and arrow
 * keys give a keyboard-accessible resize path.
 */
export default function ColumnResizer({ label, onDrag }: ColumnResizerProps) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  return (
    <div
      className="app__resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        lastX.current = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        onDrag(e.clientX - lastX.current);
        lastX.current = e.clientX;
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onDrag(-10);
        else if (e.key === 'ArrowRight') onDrag(10);
        else return;
        e.preventDefault();
      }}
    />
  );
}
