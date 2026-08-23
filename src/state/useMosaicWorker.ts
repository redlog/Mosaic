/**
 * Runs the heavy pipeline in a worker, with a synchronous fallback.
 *
 * The fallback is not just defensive: it keeps the hook usable in tests and in
 * any environment without module workers, and it runs the same `build.ts` code
 * the worker does, so results cannot diverge.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
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
}

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

export function useMosaicPipeline(
  source: PipelineSource,
  settings: BuildSettings
): PipelineStatus {
  const workerRef = useRef<Worker | null>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState<PipelineStatus>({
    result: null,
    error: null,
    busy: false,
    progress: null,
    usingWorker: true,
  });

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

  // Settings are compared by value; a new object each render must not re-run
  // a two-second tile.
  const settingsKey = useMemo(() => JSON.stringify(settings), [settings]);

  useEffect(() => {
    if (source.kind === 'none') {
      setStatus((s) => ({ ...s, result: null, busy: false, progress: null }));
      return;
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, settingsKey]);

  return status;
}
