/**
 * Seeded pseudo-random number generation.
 *
 * The pips-out tiler explores hundreds of randomized restarts, and a project
 * file stores only the seed (DESIGN.md §10.1). Reproducibility therefore
 * depends on this being deterministic and independent of the host's
 * `Math.random`.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). Returns 0 for n <= 0. */
  int(n: number): number;
  bool(): boolean;
  /** A new array with the same elements in random order. */
  shuffle<T>(items: readonly T[]): T[];
  pick<T>(items: readonly T[]): T;
}

/**
 * Mulberry32 — small, fast, and good enough for restart diversity. Not
 * cryptographic, and not meant to be.
 */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;

  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (n: number): number => (n <= 0 ? 0 : Math.floor(next() * n));

  return {
    next,
    int,
    bool: () => next() < 0.5,
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i]!;
        out[i] = out[j]!;
        out[j] = tmp;
      }
      return out;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() from an empty array');
      return items[int(items.length)]!;
    },
  };
}

/** A seed derived from the clock, for the UI's "randomize" button. */
export function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}
