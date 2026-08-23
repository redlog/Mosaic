import { availableShapesFor } from '../lego/parts';
import { REQUIRED_SHAPE, type Action, type MosaicState } from '../state/useMosaicStore';
import type { TilerWeights } from '../lego/types';

export interface AlgorithmPanelProps {
  state: MosaicState;
  dispatch: (action: Action) => void;
}

const WEIGHTS: Array<{ key: keyof TilerWeights; label: string; hint: string }> = [
  { key: 'pieces', label: 'Fewer pieces', hint: 'cost of each additional brick' },
  { key: 'ones', label: 'Avoid 1×1s', hint: 'extra cost of a single-stud brick' },
  { key: 'seam', label: 'Stagger seams', hint: 'cost of four bricks meeting at a point' },
];

export default function AlgorithmPanel({ state, dispatch }: AlgorithmPanelProps) {
  const shapes = availableShapesFor(state.mosaic.orientation);
  const inventory = new Set(state.tiler.inventory);
  const wall = state.mosaic.orientation === 'pips-up';

  return (
    <section className="panel" aria-labelledby="algo-heading">
      <h2 id="algo-heading">Bricks</h2>

      <ul className="shapes">
        {shapes.map((shape) => {
          const required = shape.designId === REQUIRED_SHAPE;
          return (
            <li key={shape.designId}>
              <label className={`check${shape.common ? '' : ' check--dim'}`}>
                <input
                  type="checkbox"
                  checked={inventory.has(shape.designId)}
                  disabled={required}
                  onChange={() =>
                    dispatch({ type: 'toggleShape', designId: shape.designId })
                  }
                />
                {shape.name.replace('Brick ', '')}
                {required && <span className="muted small"> required</span>}
                {!shape.common && <span className="muted small"> uncommon</span>}
              </label>
            </li>
          );
        })}
      </ul>

      {wall && (
        <p className="note">
          A wall uses 1×N bricks only. A 2×4 shows the same face as a 1×4 but makes the
          wall two studs deep, doubling the cost for no visual change.
        </p>
      )}

      <details>
        <summary>Advanced</summary>

        {WEIGHTS.map(({ key, label, hint }) => (
          <div className="field" key={key}>
            <label htmlFor={`w-${key}`}>
              {label}{' '}
              <span className="muted small">{state.tiler.weights[key].toFixed(2)}</span>
            </label>
            <input
              id={`w-${key}`}
              type="range"
              min={0}
              max={200}
              value={Math.round(state.tiler.weights[key] * 100)}
              onChange={(e) =>
                dispatch({
                  type: 'patchTiler',
                  patch: {
                    weights: {
                      ...state.tiler.weights,
                      [key]: Number(e.target.value) / 100,
                    },
                  },
                })
              }
            />
            <span className="muted small">{hint}</span>
          </div>
        ))}

        {!wall && (
          <div className="field">
            <label htmlFor="restarts">
              Search effort{' '}
              <span className="muted small">{state.tiler.restarts} restarts</span>
            </label>
            <input
              id="restarts"
              type="range"
              min={1}
              max={300}
              value={state.tiler.restarts}
              onChange={(e) =>
                dispatch({
                  type: 'patchTiler',
                  patch: { restarts: Number(e.target.value) },
                })
              }
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="seed">Seed</label>
          <div className="field__row">
            <input
              id="seed"
              type="number"
              value={state.tiler.seed}
              onChange={(e) =>
                dispatch({ type: 'patchTiler', patch: { seed: Number(e.target.value) } })
              }
            />
            <button type="button" onClick={() => dispatch({ type: 'randomizeSeed' })}>
              Shuffle
            </button>
          </div>
          <span className="muted small">
            {wall
              ? 'The wall tiler is exact, so the seed does not change its result.'
              : 'Same seed, same mosaic — a saved project reproduces exactly.'}
          </span>
        </div>
      </details>
    </section>
  );
}
