import { describe, expect, it } from 'vitest';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  ProjectError,
  decodeRle,
  encodeRle,
  parseProject,
  readGrid,
  serializeProject,
  validateProject,
  type ProjectFile,
} from './project';
import { mulberry32 } from './rng';

function project(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    createdAt: '2026-01-01T00:00:00.000Z',
    app: { version: '0.1.0' },
    crop: { x: 0, y: 0, w: 1, h: 1 },
    transform: { rotate: 0, flipH: false, flipV: false },
    mosaic: { orientation: 'pips-out', cols: 2, rows: 2 },
    adjust: { brightness: 0, contrast: 0, saturation: 0 },
    quantize: {
      dither: 'none',
      ditherStrength: 0,
      maxColors: null,
      strictAvailability: true,
      enabledColors: ['white', 'black'],
    },
    tiler: {
      inventory: ['3005', '3004'],
      weights: { pieces: 1, ones: 0.5, seam: 0.25 },
      restarts: 200,
      seed: 7,
    },
    palette: { id: 'builtin-v1', overrides: [] },
    grid: {
      cols: 2,
      rows: 2,
      encoding: 'rle-v1',
      colorKeys: ['white', 'black'],
      data: [
        [0, 2],
        [1, 2],
      ],
    },
    ...overrides,
  };
}

describe('run-length coding', () => {
  it('collapses runs', () => {
    expect(encodeRle(new Int16Array([0, 0, 0, 1, 1, 2]))).toEqual([
      [0, 3],
      [1, 2],
      [2, 1],
    ]);
  });

  it('handles an empty grid', () => {
    expect(encodeRle(new Int16Array(0))).toEqual([]);
    expect(decodeRle([], 0)).toEqual(new Int16Array(0));
  });

  it('round-trips random grids', () => {
    const rng = mulberry32(11);
    for (let trial = 0; trial < 40; trial++) {
      const length = 1 + rng.int(400);
      const source = new Int16Array(length);
      // Runs of a few repeated values, like a real quantized mosaic.
      for (let i = 0; i < length;) {
        const value = rng.int(6);
        const run = 1 + rng.int(9);
        for (let j = 0; j < run && i < length; j++, i++) source[i] = value;
      }
      expect(decodeRle(encodeRle(source), length)).toEqual(source);
    }
  });

  it('compresses a flat mosaic to almost nothing', () => {
    // The reason the grid can be embedded at all: real mosaics are full of
    // long same-color runs.
    expect(encodeRle(new Int16Array(48 * 48))).toHaveLength(1);
  });

  it('rejects data that does not fill the grid', () => {
    expect(() => decodeRle([[0, 3]], 10)).toThrow(/covers 3 cells/);
    expect(() => decodeRle([[0, 20]], 10)).toThrow(/longer than its stated dimensions/);
  });

  it('rejects malformed runs', () => {
    expect(() => decodeRle([[0, -1]], 5)).toThrow(/Invalid run length/);
    expect(() => decodeRle([[0] as unknown as [number, number]], 5)).toThrow(/Malformed/);
  });
});

describe('validateProject', () => {
  it('accepts a well-formed file', () => {
    expect(validateProject(project())).toMatchObject({ format: PROJECT_FORMAT });
  });

  it('rejects anything that is not a project', () => {
    for (const bad of [null, 'nope', 42, {}, { format: 'something-else' }]) {
      expect(() => validateProject(bad)).toThrow(ProjectError);
    }
  });

  /**
   * A partially-understood project is worse than a refused one: it opens
   * looking fine and is quietly wrong.
   */
  it('refuses a file from a newer version rather than guessing', () => {
    expect(() => validateProject(project({ version: PROJECT_VERSION + 1 }))).toThrow(
      /newer version of Mosaic/
    );
  });

  it('refuses an unknown grid encoding', () => {
    const file = project();
    (file.grid as { encoding: string }).encoding = 'rle-v9';
    expect(() => validateProject(file)).toThrow(/Unknown grid encoding/);
  });

  it('refuses an unknown brick', () => {
    expect(() =>
      validateProject(
        project({
          tiler: { ...project().tiler, inventory: ['3005', '9999'] },
        })
      )
    ).toThrow(/unknown brick "9999"/);
  });

  it('refuses a malformed palette override', () => {
    expect(() =>
      validateProject(
        project({ palette: { id: 'x', overrides: [{ key: 'red', hex: 'nope' }] } })
      )
    ).toThrow(/bad color/);
  });

  it('refuses a missing grid or settings', () => {
    const noGrid = project() as Partial<ProjectFile>;
    delete noGrid.grid;
    expect(() => validateProject(noGrid)).toThrow(/no grid/);

    const noMosaic = project() as Partial<ProjectFile>;
    delete noMosaic.mosaic;
    expect(() => validateProject(noMosaic)).toThrow(/missing required settings/);
  });
});

describe('readGrid', () => {
  it('decodes to the stored dimensions', () => {
    const { grid, colorKeys } = readGrid(project());
    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(2);
    expect([...grid.colors]).toEqual([0, 0, 1, 1]);
    expect(colorKeys).toEqual(['white', 'black']);
  });

  it('rejects an index with no matching color', () => {
    const file = project();
    file.grid.data = [
      [0, 2],
      [5, 2],
    ];
    expect(() => readGrid(file)).toThrow(/references color 5/);
  });
});

describe('serialize and parse', () => {
  it('round-trips through JSON', () => {
    const file = project();
    expect(parseProject(serializeProject(file))).toEqual(file);
  });

  it('reports invalid JSON clearly', () => {
    expect(() => parseProject('{ not json')).toThrow(/not valid JSON/);
  });

  it('keeps the source image out when it was not embedded', () => {
    const file = project({ source: { name: 'a.jpg', width: 10, height: 10 } });
    const text = serializeProject(file);
    expect(text).not.toContain('dataUrl');
    expect(parseProject(text).source?.dataUrl).toBeUndefined();
  });

  it('preserves an embedded image', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const file = project({ source: { name: 'a.png', width: 4, height: 4, dataUrl } });
    expect(parseProject(serializeProject(file)).source?.dataUrl).toBe(dataUrl);
  });

  /** The tiling is derived, so storing it could only create disagreement. */
  it('never stores a tiling', () => {
    expect(serializeProject(project())).not.toContain('placements');
  });
});
