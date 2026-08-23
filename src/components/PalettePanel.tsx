import {
  palette,
  type Action,
  type DerivedMosaic,
  type MosaicState,
} from '../state/useMosaicStore';

export interface PalettePanelProps {
  state: MosaicState;
  dispatch: (action: Action) => void;
  derived: DerivedMosaic;
}

export default function PalettePanel({ state, dispatch, derived }: PalettePanelProps) {
  const enabled = new Set(state.quantizeSettings.enabledColors);

  // Usage counts come back indexed against the colors quantize actually used,
  // which may be a reduced set, so map by key rather than by index.
  const usage = new Map<string, number>();
  derived.gridColors.forEach((color, i) => {
    usage.set(color.key, derived.counts[i] ?? 0);
  });

  const usedKeys = [...usage.entries()].filter(([, n]) => n > 0).map(([key]) => key);

  return (
    <section className="panel" aria-labelledby="palette-heading">
      <h2 id="palette-heading">
        Colors <span className="muted small">{enabled.size} on</span>
      </h2>

      <div className="row">
        <button
          type="button"
          onClick={() =>
            dispatch({ type: 'setColors', keys: palette.colors.map((c) => c.key) })
          }
        >
          All
        </button>
        <button
          type="button"
          disabled={usedKeys.length === 0}
          onClick={() => dispatch({ type: 'setColors', keys: usedKeys })}
          title="Drop every color the current mosaic does not use"
        >
          Only used
        </button>
      </div>

      <div className="field">
        <label htmlFor="max-colors">
          Limit distinct colors{' '}
          <span className="muted small">{state.quantizeSettings.maxColors ?? 'off'}</span>
        </label>
        <input
          id="max-colors"
          type="range"
          min={0}
          max={Math.min(40, palette.colors.length)}
          value={state.quantizeSettings.maxColors ?? 0}
          onChange={(e) => {
            const value = Number(e.target.value);
            dispatch({
              type: 'patchQuantize',
              patch: { maxColors: value === 0 ? null : value },
            });
          }}
        />
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={state.quantizeSettings.strict}
          onChange={(e) =>
            dispatch({ type: 'patchQuantize', patch: { strict: e.target.checked } })
          }
        />
        Only use bricks that exist in each color
      </label>

      <ul className="swatches">
        {palette.colors.map((color) => {
          const count = usage.get(color.key) ?? 0;
          const on = enabled.has(color.key);
          return (
            <li key={color.key}>
              <label className={`swatch${on ? '' : ' swatch--off'}`}>
                <input
                  type="checkbox"
                  className="visually-hidden"
                  checked={on}
                  onChange={() => dispatch({ type: 'toggleColor', key: color.key })}
                />
                <span
                  className="swatch__chip"
                  style={{ background: color.hex }}
                  aria-hidden="true"
                />
                <span className="swatch__name">{color.name}</span>
                <span className="swatch__count muted small">
                  {count > 0 ? count.toLocaleString() : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
