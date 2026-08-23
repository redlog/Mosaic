import { useState } from 'react';
import { toBricklinkXml, BRICKLINK_MIME } from '../lego/export-bricklink';
import { toCsv, CSV_MIME } from '../lego/export-csv';
import { renderGeometry } from '../lego/render';
import { renderToBlob } from '../browser/render-canvas';
import { downloadBlob, downloadText, exportFilename } from '../browser/download';
import { palette, type DerivedMosaic, type MosaicState } from '../state/useMosaicStore';

/** Whether the bundled color table has been checked against a real catalog. */
const PALETTE_VERIFIED = palette.provenance.verified;

export interface ExportPanelProps {
  state: MosaicState;
  derived: DerivedMosaic;
}

const SCALES = [1, 2, 4];

export default function ExportPanel({ state, derived }: ExportPanelProps) {
  const [scale, setScale] = useState(2);
  const [saving, setSaving] = useState(false);
  const { tiling, bom, gridColors } = derived;
  const ready = Boolean(tiling && bom);
  const name = state.source?.name;

  const pngGeometry = tiling
    ? renderGeometry(tiling, { pxPerStud: 24, scale, padding: 16 })
    : null;

  async function savePng() {
    if (!tiling) return;
    setSaving(true);
    try {
      const blob = await renderToBlob(tiling, gridColors, {
        pxPerStud: 24,
        scale,
        padding: 16,
        background: '#ffffff',
        mode: state.view.mode === 'clean' ? 'clean' : 'build',
      });
      downloadBlob(blob, exportFilename(name, state.view.mode, 'png'));
    } finally {
      setSaving(false);
    }
  }

  const bricklink = bom ? toBricklinkXml(bom) : null;

  return (
    <section className="panel" aria-labelledby="export-heading">
      <h2 id="export-heading">Export</h2>

      <div className="field">
        <label htmlFor="png-scale">PNG scale</label>
        <div className="segmented" role="group" aria-label="PNG scale">
          {SCALES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scale === value}
              onClick={() => setScale(value)}
            >
              {value}×
            </button>
          ))}
        </div>
        {pngGeometry && (
          <span className="muted small">
            {pngGeometry.width} × {pngGeometry.height} px
          </span>
        )}
      </div>

      <div className="row">
        <button type="button" disabled={!ready || saving} onClick={() => void savePng()}>
          {saving ? 'Rendering…' : 'PNG'}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            bom &&
            downloadText(toCsv(bom), exportFilename(name, 'parts', 'csv'), CSV_MIME)
          }
        >
          Parts CSV
        </button>
        <button
          type="button"
          disabled={!ready || bricklink?.included.length === 0}
          onClick={() =>
            bricklink &&
            downloadText(
              bricklink.xml,
              exportFilename(name, 'wanted', 'xml'),
              BRICKLINK_MIME
            )
          }
        >
          BrickLink XML
        </button>
      </div>

      <p className="muted small">
        The XML uploads to BrickLink as a Wanted List, which prices and sources the whole
        build in one step.
      </p>

      {bricklink && bricklink.warnings.length > 0 && (
        <p className="note note--warn">{bricklink.warnings.join(' ')}</p>
      )}

      {!PALETTE_VERIFIED && (
        <p className="note note--warn">
          The bundled color data is unverified — check part numbers and BrickLink color
          IDs before placing an order.
        </p>
      )}
    </section>
  );
}
