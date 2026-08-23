import { useEffect, useRef, useState } from 'react';
import { renderInto } from '../browser/render-canvas';
import { frameImage } from '../lego/frame';
import { linearToSrgb } from '../lego/color';
import { renderGeometry } from '../lego/render';
import type {
  Action,
  DerivedMosaic,
  MosaicState,
  ViewMode,
} from '../state/useMosaicStore';

export interface PreviewCanvasProps {
  state: MosaicState;
  dispatch: (action: Action) => void;
  derived: DerivedMosaic;
  busy: boolean;
}

const MODES: Array<{ value: ViewMode; label: string; hint: string }> = [
  { value: 'build', label: 'Build', hint: 'Every brick outlined — follow this to build' },
  { value: 'clean', label: 'Clean', hint: 'How it looks from across the room' },
  { value: 'source', label: 'Source', hint: 'The cropped photo, for comparison' },
];

export default function PreviewCanvas({
  state,
  dispatch,
  derived,
  busy,
}: PreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const { tiling, gridColors } = derived;
  const { mode, pxPerStud } = state.view;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (mode === 'source') {
      // Re-frame the crop at the mosaic's own resolution, so the comparison is
      // like for like: same cells, same aspect, just unquantized.
      const source = state.source;
      if (!source) return;
      const { cols, rows, orientation } = state.mosaic;
      const cells = frameImage(source.image, cols, rows, {
        crop: state.crop,
        transform: state.transform,
      });
      const geometry = renderGeometry({ cols, rows, orientation }, { pxPerStud });
      canvas.width = geometry.width;
      canvas.height = geometry.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = (row * cols + col) * 3;
          const to255 = (v: number) => Math.round(linearToSrgb(v) * 255);
          ctx.fillStyle = `rgb(${to255(cells.data[i]!)},${to255(cells.data[i + 1]!)},${to255(cells.data[i + 2]!)})`;
          const x0 = Math.round(col * geometry.cellW);
          const y0 = Math.round(row * geometry.cellH);
          ctx.fillRect(
            x0,
            y0,
            Math.round((col + 1) * geometry.cellW) - x0,
            Math.round((row + 1) * geometry.cellH) - y0
          );
        }
      }
      return;
    }

    if (!tiling) return;
    renderInto(canvas, tiling, gridColors, { mode, pxPerStud });
  }, [
    tiling,
    gridColors,
    mode,
    pxPerStud,
    state.source,
    state.crop,
    state.transform,
    state.mosaic,
  ]);

  const summary = tiling
    ? `${state.mosaic.cols} by ${state.mosaic.rows} brick mosaic, ${tiling.stats.pieces} pieces, ${derived.bom?.totals.distinctColors ?? 0} colors`
    : 'No mosaic yet';

  return (
    <section className="preview" aria-labelledby="preview-heading">
      <h2 id="preview-heading" className="visually-hidden">
        Preview
      </h2>

      <div className="preview__bar">
        <div className="segmented" role="group" aria-label="View mode">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              aria-pressed={mode === option.value}
              disabled={option.value === 'source' && !state.source}
              onClick={() =>
                dispatch({ type: 'patchView', patch: { mode: option.value } })
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="preview__zoom">
          Zoom
          <input
            type="range"
            min={40}
            max={300}
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
            aria-label="Preview zoom"
          />
        </label>

        {busy && <span className="badge">working…</span>}
      </div>

      <div className="preview__stage">
        {state.source ? (
          <canvas
            ref={canvasRef}
            className="preview__canvas"
            style={{ width: `${zoom * 100}%` }}
            aria-label={summary}
            role="img"
          />
        ) : (
          <p className="empty">Drop a photo on the left to begin.</p>
        )}
      </div>
    </section>
  );
}
