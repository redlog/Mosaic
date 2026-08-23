/**
 * Runs the heavy pipeline in a worker, with a synchronous fallback.
 *
 * The fallback is not just defensive: it keeps the hook usable in tests and in
 * any environment without module workers, and it runs the same `build.ts` code
 * the worker does, so results cannot diverge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildFromCells, buildFromGrid, type BuildSettings } from '../lego/build';
import type { DoneMessage, WorkerRequest, WorkerResponse } from '../worker/mosaic.worker';
import type { CellBuffer, Grid, Tiling } from '../lego/types';

export interface PipelineOutput {
  grid: Grid;
  colorKeys: string[];
  counts: number[];
  tiling: Tiling;
  elapsedMs: number;
}

export interface PipelineStatus {
  result: PipelineOutput | null;
  error: string | null;
  busy: boolean;
  /** 0..1 while working, null when idle. */
  progress: number | null;
  /** False when the browser gave us no worker and we are blocking the UI. */
  usingWorker: boolean;
  /**
   * Settings have changed since the displayed result was built, and no build is
   * coming on its own. Only possible with auto-rebuild off.
   */
  stale: boolean;
  /** Build now, whatever the auto-rebuild setting says. */
  rebuild: () => void;
}

/**
 * How long to wait for the input to settle before starting a build.
 *
 * A slider drag fires a change per pixel of travel. Each one used to post a
 * request, and each request cost a full tile. Coalescing them costs a delay
 * short enough to read as instant on a discrete click, yet long enough that a
 * continuous drag posts once at the end rather than forty times along the way.
 */
export const SETTLE_MS = 160;

/** Either a fresh cell buffer to quantize, or a grid restored from a project. */
export type PipelineSource =
  | { kind: 'cells'; cells: CellBuffer }
  | { kind: 'grid'; grid: Grid; colorKeys: string[] }
  | { kind: 'none' };

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('../worker/mosaic.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

type Requested = { source: PipelineSource; settings: BuildSettings } | null;

export function useMosaicPipeline(
  source: PipelineSource,
  settings: BuildSettings,
  auto = true
): PipelineStatus {
  const workerRef = useRef<Worker | null>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState<Omit<PipelineStatus, 'stale' | 'rebuild'>>({
    result: null,
    error: null,
    busy: false,
    progress: null,
    usingWorker: true,
  });

  // Settings are compared by value; a new object each render must not re-run
  // a two-second tile.
  const settingsKey = useMemo(() => JSON.stringify(settings), [settings]);

  // What the worker was last asked to build. Separating this from the live
  // inputs is what lets the request be delayed, skipped, or fired on demand.
  const [requested, setRequested] = useState<Requested>(null);
  const live = useRef({ source, settings, key: settingsKey });
  live.current = { source, settings, key: settingsKey };

  // Mirrors `requested` without re-triggering effects, so the "have the inputs
  // moved on?" test can be made anywhere without becoming a dependency.
  const built = useRef<{ source: PipelineSource; key: string } | null>(null);

  const rebuild = useCallback(() => {
    const { source: src, settings: cfg, key } = live.current;
    built.current = { source: src, key };
    setRequested({ source: src, settings: cfg });
  }, []);

  /**
   * Staleness is derived, never stored. Storing it meant the auto-rebuild
   * toggle could set it by itself, so turning auto off offered to rebuild a
   * mosaic that was already current.
   */
  const stale =
    !auto &&
    built.current !== null &&
    (built.current.source !== source || built.current.key !== settingsKey);

  // One worker for the life of the component; requests are serialized onto it.
  useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    if (!worker) setStatus((s) => ({ ...s, usingWorker: false }));
    return () => {
      worker?.terminate();
      workerRef.current = null;
    };
  }, []);

  /**
   * Decide when a build is wanted. Never builds inline — it either schedules
   * one after the input settles, or leaves the result stale and waits to be
   * asked.
   */
  useEffect(() => {
    if (source.kind === 'none') {
      built.current = null;
      setRequested(null);
      return;
    }

    const last = built.current;
    const first = last === null;
    const changed = last === null || last.source !== source || last.key !== settingsKey;

    // Toggling auto is not itself a change; without this, flipping it on would
    // spend a whole build reproducing the mosaic already on screen.
    if (!changed) return;

    // The first build always runs: auto-rebuild off should mean "stop
    // recomputing while I fiddle", not "show me nothing until I click".
    if (!auto && !first) return;

    const timer = setTimeout(rebuild, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [source, settingsKey, auto, rebuild]);

  useEffect(() => {
    if (!requested || requested.source.kind === 'none') {
      setStatus((s) => ({ ...s, result: null, busy: false, progress: null }));
      return;
    }
    const { source, settings } = requested;

    const id = ++generation.current;
    const worker = workerRef.current;

    const accept = (message: DoneMessage): void => {
      setStatus((s) => ({
        ...s,
        result: {
          grid: {
            cols: message.cols,
            rows: message.rows,
            colors: message.indices,
          },
          colorKeys: message.colorKeys,
          counts: message.counts,
          tiling: message.tiling,
          elapsedMs: message.elapsedMs,
        },
        error: null,
        busy: false,
        progress: null,
      }));
    };

    if (!worker) {
      // Synchronous fallback. Blocks, but produces the same answer.
      try {
        const started = performance.now();
        const result =
          source.kind === 'cells'
            ? buildFromCells(source.cells, settings)
            : buildFromGrid(source.grid, source.colorKeys, settings);
        accept({
          type: 'done',
          generation: id,
          cols: result.grid.cols,
          rows: result.grid.rows,
          indices: result.grid.colors,
          colorKeys: result.colorKeys,
          counts: result.counts,
          tiling: result.tiling,
          elapsedMs: performance.now() - started,
        });
      } catch (err) {
        setStatus((s) => ({
          ...s,
          error: err instanceof Error ? err.message : String(err),
          busy: false,
          progress: null,
        }));
      }
      return;
    }

    setStatus((s) => ({ ...s, busy: true, progress: 0 }));

    const onMessage = (event: MessageEvent<WorkerResponse>): void => {
      const message = event.data;
      // Stale replies are dropped rather than cancelled — see the worker.
      if (message.generation !== generation.current) return;

      if (message.type === 'progress') {
        setStatus((s) => ({ ...s, progress: message.fraction }));
      } else if (message.type === 'done') {
        accept(message);
      } else {
        setStatus((s) => ({
          ...s,
          error: message.message,
          busy: false,
          progress: null,
        }));
      }
    };

    worker.addEventListener('message', onMessage);

    // Copy before transferring: the buffer belongs to a memoized value the
    // main thread may still need, and transferring would detach it.
    const request: WorkerRequest =
      source.kind === 'cells'
        ? {
            type: 'build-cells',
            generation: id,
            cols: source.cells.cols,
            rows: source.cells.rows,
            cells: new Float32Array(source.cells.data),
            settings,
          }
        : {
            type: 'build-grid',
            generation: id,
            cols: source.grid.cols,
            rows: source.grid.rows,
            indices: new Int16Array(source.grid.colors),
            colorKeys: source.colorKeys,
            settings,
          };

    worker.postMessage(request, [
      request.type === 'build-cells' ? request.cells.buffer : request.indices.buffer,
    ]);

    return () => worker.removeEventListener('message', onMessage);
  }, [requested]);

  return useMemo(() => ({ ...status, stale, rebuild }), [status, stale, rebuild]);
}
