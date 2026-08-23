import { useEffect, useState } from 'react';
import AdjustPanel from './components/AdjustPanel';
import AlgorithmPanel from './components/AlgorithmPanel';
import ExportPanel from './components/ExportPanel';
import MosaicSettings from './components/MosaicSettings';
import PalettePanel from './components/PalettePanel';
import PartsList from './components/PartsList';
import PreviewCanvas from './components/PreviewCanvas';
import SourcePanel from './components/SourcePanel';
import StatsCard from './components/StatsCard';
import { useMosaicStore } from './state/useMosaicStore';

type Tab = 'source' | 'settings' | 'preview' | 'parts';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'source', label: 'Source' },
  { value: 'settings', label: 'Settings' },
  { value: 'preview', label: 'Preview' },
  { value: 'parts', label: 'Parts' },
];

/** Below this the three columns stack into tabs. */
const NARROW = 900;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < NARROW
  );
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${NARROW - 1}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

export default function App() {
  const { state, dispatch, derived, busy, setCrop } = useMosaicStore();
  const narrow = useNarrow();
  const [tab, setTab] = useState<Tab>('source');

  const left = (
    <>
      <SourcePanel state={state} dispatch={dispatch} setCrop={setCrop} />
      <MosaicSettings state={state} dispatch={dispatch} derived={derived} />
      <AdjustPanel state={state} dispatch={dispatch} derived={derived} />
      <PalettePanel state={state} dispatch={dispatch} derived={derived} />
      <AlgorithmPanel state={state} dispatch={dispatch} />
    </>
  );

  const right = (
    <>
      <StatsCard state={state} derived={derived} />
      <PartsList derived={derived} />
      <ExportPanel state={state} derived={derived} />
    </>
  );

  const preview = (
    <PreviewCanvas state={state} dispatch={dispatch} derived={derived} busy={busy} />
  );

  return (
    <div className="app">
      <header className="app__header">
        <h1>Mosaic</h1>
        <p className="muted small">Turn a photo into a buildable LEGO brick mosaic</p>
      </header>

      {state.error && (
        <p className="note note--warn app__error" role="status">
          {state.error}{' '}
          <button
            type="button"
            onClick={() => dispatch({ type: 'setError', error: null })}
          >
            Dismiss
          </button>
        </p>
      )}

      {/* Announcements for anyone not watching the canvas. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {derived.tiling
          ? `${derived.bom?.totals.pieces.toLocaleString() ?? 0} bricks in ${
              derived.bom?.totals.distinctColors ?? 0
            } colors, ${derived.size.widthIn.toFixed(1)} by ${derived.size.heightIn.toFixed(1)} inches`
          : 'No mosaic yet'}
      </p>

      {narrow ? (
        <>
          <nav className="tabs" aria-label="Sections">
            {TABS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={tab === option.value}
                onClick={() => setTab(option.value)}
              >
                {option.label}
              </button>
            ))}
          </nav>
          <main className="app__single">
            {tab === 'source' && (
              <SourcePanel state={state} dispatch={dispatch} setCrop={setCrop} />
            )}
            {tab === 'settings' && (
              <>
                <MosaicSettings state={state} dispatch={dispatch} derived={derived} />
                <AdjustPanel state={state} dispatch={dispatch} derived={derived} />
                <PalettePanel state={state} dispatch={dispatch} derived={derived} />
                <AlgorithmPanel state={state} dispatch={dispatch} />
              </>
            )}
            {tab === 'preview' && preview}
            {tab === 'parts' && right}
          </main>
        </>
      ) : (
        <main className="app__columns">
          <div className="app__rail">{left}</div>
          {preview}
          <div className="app__rail">{right}</div>
        </main>
      )}
    </div>
  );
}
