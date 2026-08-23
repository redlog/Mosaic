import { describe, expect, it } from 'vitest';

/**
 * Phase 0 harness check.
 *
 * Rather than asserting 1 + 1 === 2, this verifies the specific runtime
 * capabilities the domain code is built on, so a broken toolchain fails here
 * instead of somewhere confusing in Phase 1.
 */
describe('test harness', () => {
  it('runs', () => {
    expect(true).toBe(true);
  });

  it('supports the typed arrays the grid and tiler depend on', () => {
    const grid = new Int16Array(4);
    grid[2] = -1;
    expect(grid.length).toBe(4);
    expect(grid[2]).toBe(-1);
    expect(grid[0]).toBe(0);

    const cells = new Float32Array([0.25, 0.5, 0.75]);
    expect(Array.from(cells)).toEqual([0.25, 0.5, 0.75]);
  });

  it('can transfer an ArrayBuffer, as the worker protocol requires', () => {
    const buf = new ArrayBuffer(8);
    const view = new Uint8Array(buf);
    view[0] = 42;
    // structuredClone with a transfer list is how the worker hands grids back
    // to the main thread without copying.
    const moved = structuredClone(buf, { transfer: [buf] }) as ArrayBuffer;
    expect(new Uint8Array(moved)[0]).toBe(42);
    expect(buf.byteLength).toBe(0); // original is detached after transfer
  });

  it('has the ES2022 features the source targets', () => {
    expect([1, 2, 3].at(-1)).toBe(3);
    expect(Object.hasOwn({ a: 1 }, 'a')).toBe(true);
  });
});
