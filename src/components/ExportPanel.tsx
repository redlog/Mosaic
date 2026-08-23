import { useRef, useState } from 'react';
import { toBricklinkXml, BRICKLINK_MIME } from '../lego/export-bricklink';
import { toCsv, CSV_MIME } from '../lego/export-csv';
import { renderGeometry } from '../lego/render';
import { renderToBlob } from '../browser/render-canvas';
import { downloadBlob, downloadText, exportFilename } from '../browser/download';
import {
  PROJECT_MIME,
  ProjectError,
  parseProject,
  serializeProject,
} from '../lego/project';
import { fromProject, toProject } from '../state/project-io';
import {
  palette,
  type Action,
  type DerivedMosaic,
  type MosaicState,
} from '../state/useMosaicStore';

/** Whether the bundled color table has been checked against a real catalog. */
const PALETTE_VERIFIED = palette.provenance.verified;

export interface ExportPanelProps {
  state: MosaicState;
  derived: DerivedMosaic;
  dispatch: (action: Action) => void;
}

const SCALES = [1, 2, 4];

export default function ExportPanel({ state, derived, dispatch }: ExportPanelProps) {
  const [scale, setScale] = useState(2);
  const [saving, setSaving] = useState(false);
  const [embedSource, setEmbedSource] = useState(true);
  const projectInput = useRef<HTMLInputElement>(null);
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

  function saveProject() {
    if (!derived.grid) return;
    const file = toProject(state, derived.grid, derived.colorKeys, { embedSource });
    downloadText(
      serializeProject(file),
      exportFilename(state.projectName ?? name, 'project', 'json'),
      PROJECT_MIME
    );
  }

  async function openProject(file: File | undefined) {
    if (!file) return;
    try {
      const next = await fromProject(parseProject(await file.text()), file.name);
      dispatch({ type: 'loadProject', state: next });
    } catch (err) {
      dispatch({
        type: 'setError',
        error:
          err instanceof ProjectError
            ? err.message
            : `Could not open that project: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

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

      <hr />

      <h3 className="subhead">Project</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={embedSource}
          onChange={(e) => setEmbedSource(e.target.checked)}
        />
        Embed the photo
      </label>
      <p className="muted small">
        {embedSource
          ? 'Self-contained: the project reopens fully editable.'
          : 'Settings and the color grid only. Smaller, but the crop and colors cannot be changed on reopening.'}
      </p>

      <div className="row">
        <button type="button" disabled={!derived.grid} onClick={saveProject}>
          Save project
        </button>
        <button type="button" onClick={() => projectInput.current?.click()}>
          Open project
        </button>
      </div>
      <input
        ref={projectInput}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        onChange={(e) => void openProject(e.target.files?.[0])}
      />

      {state.loadedGrid && (
        <p className="note">
          Opened without its photo, so this project can be re-tiled and exported but not
          re-cropped or re-colored. Save with the photo embedded to keep those.
        </p>
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
