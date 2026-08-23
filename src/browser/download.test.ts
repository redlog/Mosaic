// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { downloadBlob, downloadText, exportFilename, safeFilename } from './download';

describe('safeFilename', () => {
  it('drops the extension and keeps the stem', () => {
    expect(safeFilename('holiday.jpg')).toBe('holiday');
    expect(safeFilename('scan.001.PNG')).toBe('scan.001');
  });

  it('strips characters that filesystems object to', () => {
    expect(safeFilename('a/b\\c:d*e?f')).toBe('abcdef');
    expect(safeFilename('  spaced  out  ')).toBe('spaced  out');
  });

  it('falls back when nothing usable is left', () => {
    expect(safeFilename('///')).toBe('mosaic');
    expect(safeFilename('', 'untitled')).toBe('untitled');
  });

  it('caps runaway lengths', () => {
    expect(safeFilename('x'.repeat(500)).length).toBeLessThanOrEqual(80);
  });
});

describe('exportFilename', () => {
  it('builds a name from the source image', () => {
    expect(exportFilename('holiday.jpg', 'parts', 'csv')).toBe('holiday-parts.csv');
    expect(exportFilename('holiday.jpg', 'wanted', 'xml')).toBe('holiday-wanted.xml');
  });

  it('handles a missing source name', () => {
    expect(exportFilename(undefined, 'parts', 'csv')).toBe('mosaic-parts.csv');
  });
});

describe('downloadBlob', () => {
  it('clicks a link carrying the blob URL and the filename', () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const clicked: HTMLAnchorElement[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked.push(this);
    };

    try {
      downloadBlob(new Blob(['hello'], { type: 'text/plain' }), 'greeting.txt');
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe('greeting.txt');
    expect(clicked[0]!.href).toBe('blob:fake');
    // The link is a means, not a leftover.
    expect(document.querySelector('a')).toBeNull();

    vi.unstubAllGlobals();
  });

  /**
   * Revoking synchronously can cancel the download in some browsers before
   * they have finished reading the blob, so it is deliberately deferred.
   */
  it('defers revoking the object URL', () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:fake', revokeObjectURL });

    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = () => {};
    try {
      downloadText('data', 'file.csv', 'text/csv');
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
