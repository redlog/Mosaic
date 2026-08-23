/// <reference lib="webworker" />
/**
 * Quantize and tile off the main thread.
 *
 * Deliberately thin: all the real work is `buildFromCells` / `buildFromGrid`
 * in src/lego/build.ts, so the worker and the synchronous fallback cannot
 * drift apart.
 *
 * **Only the newest request is ever built.** A worker's `onmessage` runs to
 * completion, so a naive handler that builds inline forces every queued request
 * through a full tile before reaching the one the user is actually waiting for.
 * Dragging a slider queued twenty builds and made the app appear to hang for
 * twelve seconds after the last input.
 *
 * Two mechanisms, because neither alone is enough:
 *
 * 1. `onmessage` only *records* the request and returns, so a burst of messages
 *    collapses into one build of the last one. Requests that never started are
 *    simply overwritten.
 * 2. A build already underway is abandoned via `shouldAbort`, checked between
 *    restarts of the tiling search. Without this, one in-flight build still has
 *    to burn its full time budget before the newest can start.
 *
 * The generation counter stays, as the main thread's final guard against a
 * stale reply that slips through.
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

/** The newest request not yet built. Overwritten freely; only the last one runs. */
let pending: WorkerRequest | null = null;
let scheduled = false;
/** Set while `run` is executing, so a request arriving mid-build can abort it. */
let building = false;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  pending = event.data;
  // Never build inline: returning immediately lets the rest of the queued
  // messages land and supersede this one before any work starts.
  if (!scheduled && !building) {
    scheduled = true;
    setTimeout(run, 0);
  }
};

function run(): void {
  scheduled = false;
  const request = pending;
  pending = null;
  if (!request) return;

  building = true;
  try {
    build(request);
  } finally {
    building = false;
  }

  // Anything that arrived while we were building — including the request that
  // aborted this one — runs next.
  if (pending && !scheduled) {
    scheduled = true;
    setTimeout(run, 0);
  }
}

function build(request: WorkerRequest): void {
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

  // A message can only land between tasks, so `pending` is the exact test for
  // "someone has asked for something newer than this".
  const superseded = (): boolean => pending !== null;

  try {
    const result =
      request.type === 'build-cells'
        ? buildFromCells(
            { cols: request.cols, rows: request.rows, data: request.cells },
            request.settings,
            onProgress,
            superseded
          )
        : buildFromGrid(
            { cols: request.cols, rows: request.rows, colors: request.indices },
            request.colorKeys,
            request.settings,
            onProgress,
            superseded
          );

    // An abandoned search returns a real but under-refined tiling. Publishing it
    // would flash a worse mosaic on screen for the moment before the newest
    // build lands, so it is dropped instead.
    if (superseded()) return;

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
}
