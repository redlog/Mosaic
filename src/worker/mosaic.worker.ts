/// <reference lib="webworker" />
/**
 * Quantize and tile off the main thread.
 *
 * Deliberately thin: all the real work is `buildFromCells` / `buildFromGrid`
 * in src/lego/build.ts, so the worker and the synchronous fallback cannot
 * drift apart.
 *
 * Cancellation is a generation counter rather than an abort signal. Every
 * request carries one; the main thread ignores any reply whose generation is
 * stale. Simpler and more robust than trying to interrupt a running tile — the
 * tiler's own time budget bounds how long a doomed run can last anyway.
 */
import { buildFromCells, buildFromGrid, type BuildSettings } from '../lego/build';

export interface BuildFromCellsRequest {
  type: 'build-cells';
  generation: number;
  cols: number;
  rows: number;
  /** Linear-light RGB, transferred. */
  cells: Float32Array;
  settings: BuildSettings;
}

export interface BuildFromGridRequest {
  type: 'build-grid';
  generation: number;
  cols: number;
  rows: number;
  /** Palette indices, transferred. */
  indices: Int16Array;
  colorKeys: string[];
  settings: BuildSettings;
}

export type WorkerRequest = BuildFromCellsRequest | BuildFromGridRequest;

export interface ProgressMessage {
  type: 'progress';
  generation: number;
  phase: 'quantize' | 'tile';
  fraction: number;
}

export interface DoneMessage {
  type: 'done';
  generation: number;
  cols: number;
  rows: number;
  indices: Int16Array;
  colorKeys: string[];
  counts: number[];
  tiling: import('../lego/types').Tiling;
  elapsedMs: number;
}

export interface ErrorMessage {
  type: 'error';
  generation: number;
  message: string;
}

export type WorkerResponse = ProgressMessage | DoneMessage | ErrorMessage;

/** Only report progress on meaningful movement; a message per restart is noise. */
const PROGRESS_STEP = 0.05;

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const { generation } = request;
  const started = performance.now();

  let lastReported = -1;
  const onProgress = (phase: 'quantize' | 'tile', fraction: number): void => {
    if (fraction < lastReported + PROGRESS_STEP && fraction < 1) return;
    lastReported = fraction;
    scope.postMessage({
      type: 'progress',
      generation,
      phase,
      fraction,
    } satisfies ProgressMessage);
  };

  try {
    const result =
      request.type === 'build-cells'
        ? buildFromCells(
            { cols: request.cols, rows: request.rows, data: request.cells },
            request.settings,
            onProgress
          )
        : buildFromGrid(
            { cols: request.cols, rows: request.rows, colors: request.indices },
            request.colorKeys,
            request.settings,
            onProgress
          );

    const message: DoneMessage = {
      type: 'done',
      generation,
      cols: result.grid.cols,
      rows: result.grid.rows,
      indices: result.grid.colors,
      colorKeys: result.colorKeys,
      counts: result.counts,
      tiling: result.tiling,
      elapsedMs: performance.now() - started,
    };
    scope.postMessage(message, [message.indices.buffer]);
  } catch (err) {
    scope.postMessage({
      type: 'error',
      generation,
      message: err instanceof Error ? err.message : String(err),
    } satisfies ErrorMessage);
  }
};
