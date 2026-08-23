import { useEffect, useRef, useState } from 'react';
import CropOverlay from './CropOverlay';
import { cropAspectFor } from '../lego/frame';
import {
  ACCEPTED_TYPES,
  LARGE_IMAGE_PIXELS,
  decodeImageFile,
  isAcceptedType,
} from '../browser/decode';
import type { Action, MosaicState } from '../state/useMosaicStore';
import type { CropRect, Rotation } from '../lego/types';

export interface SourcePanelProps {
  state: MosaicState;
  dispatch: (action: Action) => void;
  setCrop: (crop: CropRect) => void;
}

/** Paint the decoded pixels back out so the crop overlay has something to sit on. */
function useThumbnail(state: MosaicState) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const source = state.source;
    if (!canvas || !source) return;
    canvas.width = source.image.width;
    canvas.height = source.image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Copy into a plain ArrayBuffer-backed view: the decoded data may be
    // backed by a SharedArrayBuffer, which ImageData will not accept.
    ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(source.image.data),
        source.image.width,
        source.image.height
      ),
      0,
      0
    );
  }, [state.source]);
  return ref;
}

export default function SourcePanel({ state, dispatch, setCrop }: SourcePanelProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useThumbnail(state);

  async function load(file: File | undefined) {
    if (!file) return;
    if (!isAcceptedType(file.type)) {
      dispatch({
        type: 'setError',
        error: `${file.name || 'That file'} is not a PNG or JPEG.`,
      });
      return;
    }
    setLoading(true);
    try {
      const decoded = await decodeImageFile(file);
      dispatch({
        type: 'setSource',
        source: {
          name: file.name,
          image: { width: decoded.width, height: decoded.height, data: decoded.data },
          naturalWidth: decoded.naturalWidth,
          naturalHeight: decoded.naturalHeight,
        },
      });
      if (decoded.naturalWidth * decoded.naturalHeight > LARGE_IMAGE_PIXELS) {
        dispatch({
          type: 'setError',
          error: `That image is ${(
            (decoded.naturalWidth * decoded.naturalHeight) /
            1_000_000
          ).toFixed(
            0
          )} megapixels — it was scaled down ${decoded.downscale}x for processing.`,
        });
      }
    } catch (err) {
      dispatch({
        type: 'setError',
        error: err instanceof Error ? err.message : 'Could not read that image.',
      });
    } finally {
      setLoading(false);
    }
  }

  const rotate = (delta: number) => {
    const next = (((state.transform.rotate + delta) % 360) + 360) % 360;
    dispatch({ type: 'patchTransform', patch: { rotate: next as Rotation } });
  };

  const source = state.source;
  const aspect = cropAspectFor(
    state.mosaic.cols,
    state.mosaic.rows,
    state.mosaic.orientation
  );

  return (
    <section className="panel" aria-labelledby="source-heading">
      <h2 id="source-heading">Source</h2>

      {!source && (
        <div
          className={`dropzone${dragging ? ' dropzone--active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void load(e.dataTransfer.files[0]);
          }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <strong>{loading ? 'Reading image…' : 'Drop a photo here'}</strong>
          <span className="muted">PNG or JPEG, or click to choose</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="visually-hidden"
        onChange={(e) => void load(e.target.files?.[0])}
      />

      {source && (
        <>
          <div className="thumb">
            <canvas ref={canvasRef} className="thumb__image" />
            <CropOverlay
              crop={state.crop}
              onChange={setCrop}
              imageWidth={source.naturalWidth}
              imageHeight={source.naturalHeight}
              aspect={aspect}
            />
          </div>

          <p className="muted small">
            {source.name} — {source.naturalWidth} × {source.naturalHeight}
          </p>

          <div className="row">
            <button type="button" onClick={() => dispatch({ type: 'fitCrop' })}>
              Fit
            </button>
            <button type="button" onClick={() => rotate(-90)} aria-label="Rotate left">
              ⟲
            </button>
            <button type="button" onClick={() => rotate(90)} aria-label="Rotate right">
              ⟳
            </button>
            <button
              type="button"
              aria-pressed={state.transform.flipH}
              onClick={() =>
                dispatch({
                  type: 'patchTransform',
                  patch: { flipH: !state.transform.flipH },
                })
              }
            >
              Flip H
            </button>
            <button
              type="button"
              aria-pressed={state.transform.flipV}
              onClick={() =>
                dispatch({
                  type: 'patchTransform',
                  patch: { flipV: !state.transform.flipV },
                })
              }
            >
              Flip V
            </button>
          </div>

          <div className="row">
            <button type="button" onClick={() => inputRef.current?.click()}>
              Replace image
            </button>
            <button type="button" onClick={() => dispatch({ type: 'clearSource' })}>
              Remove
            </button>
          </div>
        </>
      )}
    </section>
  );
}
