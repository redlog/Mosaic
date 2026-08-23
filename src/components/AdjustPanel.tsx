import type { Action, DerivedMosaic, MosaicState } from '../state/useMosaicStore';
import { NO_ADJUSTMENTS } from '../lego/adjust';
import type { Adjustments } from '../lego/types';

export interface AdjustPanelProps {
  state: MosaicState;
  dispatch: (action: Action) => void;
  derived: DerivedMosaic;
}

const SLIDERS: Array<{ key: keyof Adjustments; label: string }> = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
];

export default function AdjustPanel({ state, dispatch, derived }: AdjustPanelProps) {
  const { adjust, quantizeSettings } = state;
  const dithering = quantizeSettings.dither !== 'none';
  const ones = derived.tiling?.stats.ones ?? 0;

  return (
    <section className="panel" aria-labelledby="adjust-heading">
      <h2 id="adjust-heading">Image</h2>

      {SLIDERS.map(({ key, label }) => (
        <div className="field" key={key}>
          <label htmlFor={`adj-${key}`}>
            {label} <span className="muted small">{adjust[key]}</span>
          </label>
          <input
            id={`adj-${key}`}
            type="range"
            min={-100}
            max={100}
            value={adjust[key]}
            onChange={(e) =>
              dispatch({
                type: 'patchAdjust',
                patch: { [key]: Number(e.target.value) } as Partial<Adjustments>,
              })
            }
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => dispatch({ type: 'patchAdjust', patch: NO_ADJUSTMENTS })}
      >
        Reset adjustments
      </button>

      <hr />

      <label className="check">
        <input
          type="checkbox"
          checked={dithering}
          onChange={(e) =>
            dispatch({
              type: 'patchQuantize',
              patch: {
                dither: e.target.checked ? 'floyd-steinberg' : 'none',
                ditherStrength: e.target.checked ? 0.6 : 0,
              },
            })
          }
        />
        Dither
      </label>

      {dithering && (
        <div className="field">
          <label htmlFor="dither-strength">
            Strength{' '}
            <span className="muted small">
              {Math.round(quantizeSettings.ditherStrength * 100)}%
            </span>
          </label>
          <input
            id="dither-strength"
            type="range"
            min={0}
            max={100}
            value={Math.round(quantizeSettings.ditherStrength * 100)}
            onChange={(e) =>
              dispatch({
                type: 'patchQuantize',
                patch: { ditherStrength: Number(e.target.value) / 100 },
              })
            }
          />
        </div>
      )}

      {/*
        The cost of dithering is shown at the moment of choosing it, because
        it works directly against the tiler: broken-up flat regions cannot be
        merged into large bricks.
      */}
      <p className="note">
        Dithering smooths gradients but shatters flat areas into 1×1s.
        {ones > 0 && (
          <>
            {' '}
            Currently <strong>{ones.toLocaleString()}</strong> 1×1
            {ones === 1 ? '' : 's'}.
          </>
        )}
      </p>
    </section>
  );
}
