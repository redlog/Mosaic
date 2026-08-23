import { describe, expect, it } from 'vitest';
import { mulberry32, randomSeed } from './rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 200; i++) expect(a.next()).toBe(b.next());
  });

  /**
   * Reproducibility matters beyond tidiness: a project file stores only the
   * seed and recomputes the tiling on load (DESIGN.md §10.1), so a generator
   * that drifted would make saved projects reopen as different mosaics.
   */
  it('reproduces a sequence from a stored seed alone', () => {
    const seed = 987654321;
    const first = Array.from({ length: 10 }, () => mulberry32(seed).next());
    expect(new Set(first).size).toBe(1);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, mulberry32(1).next);
    const b = Array.from({ length: 20 }, mulberry32(2).next);
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const rng = mulberry32(7);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(rng.next() * 10)]! += 1;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 - n / 100);
      expect(count).toBeLessThan(n / 10 + n / 100);
    }
  });

  it('handles negative and zero seeds', () => {
    expect(() => mulberry32(0).next()).not.toThrow();
    expect(mulberry32(-5).next()).toBeGreaterThanOrEqual(0);
  });
});

describe('int', () => {
  it('stays in [0, n)', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('covers the whole range', () => {
    const rng = mulberry32(11);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(5));
    expect(seen).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it('returns 0 for non-positive n instead of NaN', () => {
    const rng = mulberry32(1);
    expect(rng.int(0)).toBe(0);
    expect(rng.int(-3)).toBe(0);
  });
});

describe('shuffle', () => {
  const source = [1, 2, 3, 4, 5, 6, 7, 8];

  it('returns a permutation, not a resampling', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 50; i++) {
      const out = rng.shuffle(source);
      expect([...out].sort((a, b) => a - b)).toEqual(source);
    }
  });

  it('does not mutate its input', () => {
    const input = [...source];
    mulberry32(5).shuffle(input);
    expect(input).toEqual(source);
  });

  it('actually reorders', () => {
    const rng = mulberry32(2024);
    const results = Array.from({ length: 20 }, () => rng.shuffle(source).join(','));
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it('handles empty and single-element arrays', () => {
    const rng = mulberry32(1);
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['x'])).toEqual(['x']);
  });
});

describe('pick', () => {
  it('always returns a member', () => {
    const rng = mulberry32(8);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
  });

  it('throws on an empty array rather than returning undefined', () => {
    expect(() => mulberry32(1).pick([])).toThrow(/empty/);
  });
});

describe('randomSeed', () => {
  it('produces distinct non-negative 32-bit integers', () => {
    const seeds = new Set(Array.from({ length: 50 }, randomSeed));
    expect(seeds.size).toBeGreaterThan(40);
    for (const s of seeds) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });
});
