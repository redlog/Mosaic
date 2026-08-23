import {
  MAX_GRID_DIMENSION,
  MIN_GRID_DIMENSION,
  WARN_GRID_DIMENSION,
} from '../lego/constants';
import type { Action, DerivedMosaic, MosaicState } from '../state/useMosaicStore';
import type { Orientation } from '../lego/types';

export interface MosaicSettingsProps {
  state: MosaicState;
  dispatch: (action: Action) => void;
  derived: DerivedMosaic;
}

const ORIENTATIONS: Array<{
  value: Orientation;
  label: string;
  detail: string;
  cell: string;
}> = [
  {
    value: 'pips-out',
    label: 'Pips out',
    detail: 'Flat on a baseplate, studs facing you',
    cell: 'square cells',
  },
  {
    value: 'pips-up',
    label: 'Pips up',
    detail: 'Stacked wall, smooth face, studs hidden',
    cell: '5:6 cells, taller',
  },
];

export default function MosaicSettings({
  state,
  dispatch,
  derived,
}: MosaicSettingsProps) {
  const { mosaic } = state;
  const { size, baseplates, tooLarge } = derived;

  return (
    <section className="panel" aria-labelledby="mosaic-heading">
      <h2 id="mosaic-heading">Mosaic</h2>

      <fieldset className="orient">
        <legend className="visually-hidden">Orientation</legend>
        {ORIENTATIONS.map((option) => (
          <label
            key={option.value}
            className={`orient__card${
              mosaic.orientation === option.value ? ' orient__card--on' : ''
            }`}
          >
            <input
              type="radio"
              name="orientation"
              className="visually-hidden"
              checked={mosaic.orientation === option.value}
              onChange={() =>
                dispatch({
                  type: 'patchMosaic',
                  patch: { orientation: option.value },
                })
              }
            />
            <span
              className={`orient__glyph orient__glyph--${option.value}`}
              aria-hidden="true"
            />
            <strong>{option.label}</strong>
            <span className="muted small">{option.detail}</span>
            <span className="muted small">{option.cell}</span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="cols">Width in bricks</label>
        <div className="field__row">
          <input
            id="cols"
            type="range"
            min={MIN_GRID_DIMENSION}
            max={WARN_GRID_DIMENSION}
            value={mosaic.cols}
            onChange={(e) =>
              dispatch({ type: 'patchMosaic', patch: { cols: Number(e.target.value) } })
            }
          />
          <input
            type="number"
            aria-label="Width in bricks"
            min={MIN_GRID_DIMENSION}
            max={MAX_GRID_DIMENSION}
            value={mosaic.cols}
            onChange={(e) =>
              dispatch({ type: 'patchMosaic', patch: { cols: Number(e.target.value) } })
            }
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="rows">Height in bricks</label>
        <div className="field__row">
          <input
            id="rows"
            type="range"
            min={MIN_GRID_DIMENSION}
            max={WARN_GRID_DIMENSION}
            value={mosaic.rows}
            onChange={(e) =>
              dispatch({ type: 'patchMosaic', patch: { rows: Number(e.target.value) } })
            }
          />
          <input
            type="number"
            aria-label="Height in bricks"
            min={MIN_GRID_DIMENSION}
            max={MAX_GRID_DIMENSION}
            value={mosaic.rows}
            onChange={(e) =>
              dispatch({ type: 'patchMosaic', patch: { rows: Number(e.target.value) } })
            }
          />
        </div>
      </div>

      <p className="note">
        Drag the crop to any shape; the brick counts follow it, and changing a brick count
        reshapes the other to match. The crop and the finished mosaic always share
        proportions, or the picture comes out stretched.
      </p>

      <dl className="readout">
        <dt>Finished size</dt>
        <dd>
          {size.widthIn.toFixed(1)}&Prime; × {size.heightIn.toFixed(1)}&Prime;
          <span className="muted small">
            {' '}
            ({size.widthCm.toFixed(1)} × {size.heightCm.toFixed(1)} cm)
          </span>
        </dd>
        <dt>Studs</dt>
        <dd>{size.studs.toLocaleString()}</dd>
        {mosaic.orientation === 'pips-out' && (
          <>
            <dt>Baseplates</dt>
            <dd>
              {baseplates.across} × {baseplates.down} (48×48)
            </dd>
          </>
        )}
      </dl>

      {/*
        A one-stud-deep wall is a real structure with real limits, and the
        tiler's seam staggering can only do so much (DESIGN.md §7.3).
      */}
      {mosaic.orientation === 'pips-up' && mosaic.rows > 40 && (
        <p className="note">
          A wall this tall is {size.heightIn.toFixed(0)}&Prime; of bricks one stud deep.
          Build it on a plate or baseplate foundation, and plan on a frame or a second
          layer behind it — staggered seams stop it splitting, but they cannot make it
          rigid.
        </p>
      )}

      {tooLarge && (
        <p className="note note--warn">
          Above {WARN_GRID_DIMENSION} bricks a side, tiling gets slow. The hard limit is{' '}
          {MAX_GRID_DIMENSION}.
        </p>
      )}
    </section>
  );
}
