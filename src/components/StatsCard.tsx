import { naivePieceCount } from '../lego/tile';
import type { DerivedMosaic, MosaicState } from '../state/useMosaicStore';

export interface StatsCardProps {
  state: MosaicState;
  derived: DerivedMosaic;
}

export default function StatsCard({ state, derived }: StatsCardProps) {
  const { tiling, bom, size } = derived;
  if (!tiling || !bom) return null;

  const naive = naivePieceCount({
    cols: state.mosaic.cols,
    rows: state.mosaic.rows,
    colors: new Int16Array(0),
  });
  const reduction = naive / Math.max(1, bom.totals.pieces);
  const maxShape = Math.max(...bom.shapeTotals.map((s) => s.quantity), 1);

  return (
    <section className="panel" aria-labelledby="stats-heading">
      <h2 id="stats-heading">Result</h2>

      <dl className="readout">
        <dt>Size</dt>
        <dd>
          {size.widthIn.toFixed(1)}&Prime; × {size.heightIn.toFixed(1)}&Prime;
        </dd>
        <dt>Bricks</dt>
        <dd>
          {bom.totals.pieces.toLocaleString()}
          <span className="muted small">
            {' '}
            — {reduction.toFixed(1)}× fewer than {naive.toLocaleString()} 1×1s
          </span>
        </dd>
        <dt>Lots to order</dt>
        <dd>{bom.totals.distinctParts}</dd>
        <dt>Colors</dt>
        <dd>{bom.totals.distinctColors}</dd>
        <dt>1×1s</dt>
        <dd>
          {bom.totals.ones.toLocaleString()}
          <span className="muted small">
            {' '}
            ({(bom.totals.onesFraction * 100).toFixed(1)}%)
          </span>
        </dd>
        {state.mosaic.orientation === 'pips-up' && (
          <>
            <dt>Aligned seams</dt>
            <dd>
              {tiling.stats.alignedSeams.toLocaleString()}
              <span className="muted small">
                {tiling.stats.alignedSeams === 0 ? ' — clean running bond' : ''}
              </span>
            </dd>
          </>
        )}
      </dl>

      <ul className="bars">
        {bom.shapeTotals.map((shape) => (
          <li key={shape.designId}>
            <span className="bars__label">{shape.partName.replace('Brick ', '')}</span>
            <span className="bars__track">
              <span
                className="bars__fill"
                style={{ width: `${(shape.quantity / maxShape) * 100}%` }}
              />
            </span>
            <span className="bars__value">{shape.quantity.toLocaleString()}</span>
          </li>
        ))}
      </ul>

      <p className="muted small">
        Tiled in {Math.round(derived.elapsedMs)} ms
        {tiling.stats.trials > 1 && <> over {tiling.stats.trials} restarts</>}.
      </p>
    </section>
  );
}
