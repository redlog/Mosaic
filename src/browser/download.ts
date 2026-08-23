/**
 * Handing a file to the user. DOM-dependent, so it lives here rather than in
 * src/lego/.
 */

/** Strip characters that filesystems or browsers object to. */
export function safeFilename(name: string, fallback = 'mosaic'): string {
  const cleaned = name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^\w \-.]+/g, '')
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Build an export filename from the source image's name.
 * `holiday.jpg` + `parts` + `csv` becomes `holiday-parts.csv`.
 */
export function exportFilename(
  sourceName: string | undefined,
  suffix: string,
  extension: string
): string {
  const base = safeFilename(sourceName ?? 'mosaic');
  return `${base}-${suffix}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Deferred: revoking synchronously can cancel the download in some
    // browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export function downloadText(text: string, filename: string, mime: string): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}
