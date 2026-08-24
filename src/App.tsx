import { useEffect, useState } from 'react';
import AdjustPanel from './components/AdjustPanel';
import AlgorithmPanel from './components/AlgorithmPanel';
import ColumnResizer from './components/ColumnResizer';
import ExportPanel from './components/ExportPanel';
import MosaicSettings from './components/MosaicSettings';
import PalettePanel from './components/PalettePanel';
import PartsInfoPage from './components/PartsInfoPage';
import PartsList from './components/PartsList';
import PreviewCanvas from './components/PreviewCanvas';
import SourcePanel from './components/SourcePanel';
import StatsCard from './components/StatsCard';
import { useMosaicStore } from './state/useMosaicStore';

type Page = 'mosaic' | 'parts-info';

/** The whole app is one route, so the hash alone tells us which page to show. */
function pageFromHash(): Page {
  return window.location.hash === '#/parts-info' ? 'parts-info' : 'mosaic';
}

function usePage(): Page {
  const [page, setPage] = useState<Page>(() => pageFromHash());
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return page;
}

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

const DEFAULT_LEFT_WIDTH = 336; // 21rem at the default 16px root
const DEFAULT_RIGHT_WIDTH = 304; // 19rem
const MIN_RAIL_WIDTH = 220;
const MAX_RAIL_WIDTH = 520;
const WIDTH_STORAGE_KEY = 'mosaic.columnWidths';

function readStoredWidths(): { left: number; right: number } {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!raw) return { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH };
    const parsed = JSON.parse(raw) as { left?: number; right?: number };
    return {
      left: typeof parsed.left === 'number' ? parsed.left : DEFAULT_LEFT_WIDTH,
      right: typeof parsed.right === 'number' ? parsed.right : DEFAULT_RIGHT_WIDTH,
    };
  } catch {
    return { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH };
  }
}

/** Draggable widths for the left and right rails; the middle column fills the rest. */
function useColumnWidths() {
  const [leftWidth, setLeftWidth] = useState(() => readStoredWidths().left);
  const [rightWidth, setRightWidth] = useState(() => readStoredWidths().right);

  useEffect(() => {
    try {
      localStorage.setItem(
        WIDTH_STORAGE_KEY,
        JSON.stringify({ left: leftWidth, right: rightWidth })
      );
    } catch {
      // Private browsing or a full quota — resizing still works, it just won't persist.
    }
  }, [leftWidth, rightWidth]);

  const clamp = (w: number) => Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, w));

  return {
    leftWidth,
    rightWidth,
    growLeft: (dx: number) => setLeftWidth((w) => clamp(w + dx)),
    growRight: (dx: number) => setRightWidth((w) => clamp(w - dx)),
  };
}

export default function App() {
  const {
    state,
    dispatch,
    derived,
    busy,
    progress,
    usingWorker,
    stale,
    rebuild,
    setCrop,
  } = useMosaicStore();
  const narrow = useNarrow();
  const page = usePage();
  const [tab, setTab] = useState<Tab>('source');
  const { leftWidth, rightWidth, growLeft, growRight } = useColumnWidths();

  const left = (
    <>
      <SourcePanel state={state} dispatch={dispatch} setCrop={setCrop} />
      <MosaicSettings state={state} dispatch={dispatch} derived={derived} />
      <AdjustPanel state={state} dispatch={dispatch} derived={derived} />
      <PalettePanel state={state} dispatch={dispatch} derived={derived} />
      <AlgorithmPanel
        state={state}
        dispatch={dispatch}
        busy={busy}
        stale={stale}
        rebuild={rebuild}
      />
    </>
  );

  const right = (
    <>
      <StatsCard state={state} derived={derived} />
      <PartsList derived={derived} />
      <ExportPanel state={state} derived={derived} dispatch={dispatch} />
    </>
  );

  const preview = (
    <PreviewCanvas
      state={state}
      dispatch={dispatch}
      derived={derived}
      busy={busy}
      progress={progress}
      usingWorker={usingWorker}
    />
  );

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__header-row">
          <h1>Mosaic</h1>
          <nav className="app__nav" aria-label="Pages">
            <a href="#/" aria-current={page === 'mosaic' ? 'page' : undefined}>
              Mosaic
            </a>
            <a
              href="#/parts-info"
              aria-current={page === 'parts-info' ? 'page' : undefined}
            >
              Parts Info
            </a>
          </nav>
        </div>
        <p className="muted small">Turn a photo into a buildable LEGO brick mosaic</p>
      </header>

      {page === 'parts-info' ? (
        <main className="app__page">
          <PartsInfoPage />
        </main>
      ) : (
        <>
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
                    <AlgorithmPanel
                      state={state}
                      dispatch={dispatch}
                      busy={busy}
                      stale={stale}
                      rebuild={rebuild}
                    />
                  </>
                )}
                {tab === 'preview' && preview}
                {tab === 'parts' && right}
              </main>
            </>
          ) : (
            <main
              className="app__columns"
              style={{
                gridTemplateColumns: `${leftWidth}px 5px minmax(0, 1fr) 5px ${rightWidth}px`,
              }}
            >
              <div className="app__rail">{left}</div>
              <ColumnResizer label="Resize left panel" onDrag={growLeft} />
              {preview}
              <ColumnResizer label="Resize right panel" onDrag={growRight} />
              <div className="app__rail">{right}</div>
            </main>
          )}
        </>
      )}
    </div>
  );
}
