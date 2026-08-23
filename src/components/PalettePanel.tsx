import { isCurrent } from '../lego/palette';
import {
  DEFAULT_COLOR_KEYS,
  palette,
  type Action,
  type DerivedMosaic,
  type MosaicState,
} from '../state/useMosaicStore';

/**
 * Why a color is off by default, for the badge next to its name. Colors with
 * neither note are the ordinary case and get no badge.
 */
function aside(color: (typeof palette.colors)[number]): string | null {
  const finish = color.finish ?? 'solid';
  if (finish !== 'solid') return finish === 'transparent' ? 'trans' : finish;
  if (!isCurrent(color)) return `retired ${color.years?.[1] ?? ''}`.trim();
  return null;
}

export interface PalettePanelProps {
  state: MosaicState;
  dispatch: (action: Action) => void;
  derived: DerivedMosaic;
}

export default function PalettePanel({ state, dispatch, derived }: PalettePanelProps) {
  const enabled = new Set(state.quantizeSettings.enabledColors);
  // The color mapping is baked into a restored grid; changing the selection
  // cannot re-run without the source pixels.
  const disabled = state.source === null;

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

      {disabled && (
        <p className="note">Colors are fixed for a project opened without its photo.</p>
      )}

      <p className="muted small">
        Every color LEGO makes these bricks in, {palette.colors.length} of them. Retired
        colors and non-solid finishes are listed but start off: a chrome or transparent
        brick shows the room rather than its own color, so matching one to a photo by
        color distance does not mean much.
      </p>

      <div className="row">
        <button
          type="button"
          disabled={disabled}
          onClick={() => dispatch({ type: 'setColors', keys: [...DEFAULT_COLOR_KEYS] })}
          title="Currently-produced solid colors — the set a new project starts with"
        >
          Standard
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            dispatch({ type: 'setColors', keys: palette.colors.map((c) => c.key) })
          }
          title="Everything the catalog has, including retired, transparent and metallic"
        >
          All
        </button>
        <button
          type="button"
          disabled={disabled || usedKeys.length === 0}
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
          disabled={disabled}
          min={0}
          max={Math.min(64, palette.colors.length)}
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
          disabled={disabled}
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
          const note = aside(color);
          return (
            <li key={color.key}>
              <label className={`swatch${on ? '' : ' swatch--off'}`}>
                <input
                  type="checkbox"
                  className="visually-hidden"
                  disabled={disabled}
                  checked={on}
                  onChange={() => dispatch({ type: 'toggleColor', key: color.key })}
                />
                <span
                  className="swatch__chip"
                  style={{ background: color.hex }}
                  aria-hidden="true"
                />
                <span className="swatch__name">
                  {color.name}
                  {note && <span className="muted small"> {note}</span>}
                </span>
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
