import { useRef, useState } from 'react';
import { toBricklinkXml, BRICKLINK_MIME } from '../lego/export-bricklink';
import { toCsv, CSV_MIME } from '../lego/export-csv';
import { toPickABrickCsv, PICKABRICK_MIME } from '../lego/export-pickabrick';
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
import { elementCoverage } from '../lego/palette';
import {
  palette,
  type Action,
  type DerivedMosaic,
  type MosaicState,
} from '../state/useMosaicStore';

/** Whether the bundled color table has been checked against a real catalog. */
const PALETTE_VERIFIED = palette.provenance.verified;

/**
 * BrickLink IDs are tracked apart from the rest: nothing in the LEGO or
 * Rebrickable data carries one, so they stay hand-maintained even once
 * everything else is generated.
 */
const BRICKLINK_VERIFIED = palette.provenance.bricklinkVerified !== false;

/**
 * How many (color, brick) pairs carry an element ID. Resolved once — the
 * palette does not change at runtime.
 */
const ELEMENTS = elementCoverage(palette.colors);

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
  const pickABrick = bom ? toPickABrickCsv(bom) : null;

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
          disabled={!ready || pickABrick?.included.length === 0}
          title="lego.com Pick a Brick — element IDs, not design IDs"
          onClick={() =>
            pickABrick &&
            downloadText(
              pickABrick.csv,
              exportFilename(name, 'pick-a-brick', 'csv'),
              PICKABRICK_MIME
            )
          }
        >
          Pick a Brick CSV
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
        The BrickLink XML uploads as a Wanted List. The Pick a Brick CSV imports at
        lego.com and is keyed by <strong>element ID</strong> — one specific brick in one
        specific colour — which is a lookup, not something derivable from the design ID.
      </p>

      {ELEMENTS.known === 0 ? (
        <p className="note note--warn">
          No element IDs are loaded, so the Pick a Brick export has nothing to write.
          Element IDs are a lookup table — none were invented. Rebuild the palette with{' '}
          <code>npm run palette:build</code>.
        </p>
      ) : (
        ELEMENTS.known < ELEMENTS.total && (
          <p className="note">
            Element IDs known for {ELEMENTS.known} of {ELEMENTS.total} brick-and-colour
            pairs. Anything missing is left out of the Pick a Brick file rather than
            guessed.
          </p>
        )
      )}

      {/* With no element table loaded at all, the note above already says this. */}
      {ELEMENTS.known > 0 && pickABrick && pickABrick.warnings.length > 0 && (
        <p className="note note--warn">{pickABrick.warnings.join(' ')}</p>
      )}

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

      {!PALETTE_VERIFIED ? (
        <p className="note note--warn">
          The bundled color data is unverified — check part numbers and BrickLink color
          IDs before placing an order.
        </p>
      ) : (
        !BRICKLINK_VERIFIED && (
          <p className="note">
            Colors, availability and element IDs come from the LEGO catalog. BrickLink
            color IDs do not — no export carries one — so they are hand-maintained and
            worth a glance before you upload a Wanted List. The Pick a Brick CSV is
            unaffected.
          </p>
        )
      )}
    </section>
  );
}
