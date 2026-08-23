import { describe, expect, it } from 'vitest';
import {
  BRICK_HEIGHT_MM,
  STUD_PITCH_MM,
  baseplatesFor,
  cellSize,
  finishedSize,
  mosaicAspect,
} from './constants';

describe('cell geometry', () => {
  it('is square laid flat and 5:6 stood up', () => {
    expect(cellSize('pips-out')).toEqual({ w: 8.0, h: 8.0 });
    expect(cellSize('pips-up')).toEqual({ w: 8.0, h: 9.6 });
  });

  it('keeps brick height at exactly 1.2 x the stud pitch', () => {
    expect(BRICK_HEIGHT_MM / STUD_PITCH_MM).toBeCloseTo(1.2, 12);
  });
});

describe('finishedSize', () => {
  it('makes a 48x48 pips-out mosaic 15.118 inches square', () => {
    const size = finishedSize(48, 48, 'pips-out');
    expect(size.widthMm).toBe(384);
    expect(size.heightMm).toBe(384);
    expect(size.widthIn).toBeCloseTo(15.118, 3);
    expect(size.heightIn).toBeCloseTo(15.118, 3);
  });

  it('makes 48 courses pips-up 18.142 inches tall — taller than it is wide', () => {
    const size = finishedSize(48, 48, 'pips-up');
    expect(size.widthMm).toBe(384);
    expect(size.heightMm).toBeCloseTo(460.8, 10);
    expect(size.widthIn).toBeCloseTo(15.118, 3);
    expect(size.heightIn).toBeCloseTo(18.142, 3);
    expect(size.heightIn).toBeGreaterThan(size.widthIn);
  });

  it('reports centimetres and stud count alongside', () => {
    const size = finishedSize(32, 16, 'pips-out');
    expect(size.widthCm).toBeCloseTo(25.6, 10);
    expect(size.heightCm).toBeCloseTo(12.8, 10);
    expect(size.studs).toBe(512);
  });
});

describe('mosaicAspect', () => {
  it('equals cols/rows only in pips-out', () => {
    expect(mosaicAspect(48, 48, 'pips-out')).toBeCloseTo(1, 12);
    expect(mosaicAspect(64, 32, 'pips-out')).toBeCloseTo(2, 12);
  });

  it('is 5:6 for a square pips-up grid, which is what stops it squashing', () => {
    expect(mosaicAspect(48, 48, 'pips-up')).toBeCloseTo(5 / 6, 12);
  });

  it('matches the finished physical proportions in both orientations', () => {
    for (const orientation of ['pips-out', 'pips-up'] as const) {
      const size = finishedSize(37, 23, orientation);
      expect(mosaicAspect(37, 23, orientation)).toBeCloseTo(
        size.widthMm / size.heightMm,
        12
      );
    }
  });
});

describe('baseplatesFor', () => {
  it('fits one plate exactly at 48x48', () => {
    expect(baseplatesFor(48, 48)).toEqual({ across: 1, down: 1, total: 1 });
  });

  it('rounds up on every overhang', () => {
    expect(baseplatesFor(49, 48)).toEqual({ across: 2, down: 1, total: 2 });
    expect(baseplatesFor(96, 96)).toEqual({ across: 2, down: 2, total: 4 });
    expect(baseplatesFor(1, 1)).toEqual({ across: 1, down: 1, total: 1 });
  });

  it('accepts a different plate size', () => {
    expect(baseplatesFor(64, 64, 32)).toEqual({ across: 2, down: 2, total: 4 });
  });
});
