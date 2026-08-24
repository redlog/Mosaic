import { useMemo, useState, type CSSProperties } from 'react';
import { isCurrent } from '../lego/palette';
import { getShape } from '../lego/parts';
import { palette } from '../state/useMosaicStore';

type PaletteColor = (typeof palette.colors)[number];

/** "1×1" for a design ID, per the shared brick catalog. */
function sizeLabel(designId: string): string {
  const shape = getShape(designId);
  return `${shape.w}×${shape.h}`;
}

/**
 * Perceived brightness (ITU-R BT.601), 0-255. Used only to pick black or
 * white row text when a row is recolored to its own swatch on hover.
 */
function brightness([r, g, b]: PaletteColor['rgb']): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/** Inline custom properties a `<tr>` reads on hover — see the `.colors-table` CSS. */
function rowColorVars(color: PaletteColor): CSSProperties {
  return {
    '--row-color': color.hex,
    '--row-text': brightness(color.rgb) > 150 ? '#000' : '#fff',
  } as CSSProperties;
}

/** Same badge logic as the palette panel, so the two stay in sync. */
function aside(color: PaletteColor): string | null {
  const finish = color.finish ?? 'solid';
  if (finish !== 'solid') return finish === 'transparent' ? 'trans' : finish;
  if (!isCurrent(color)) return `retired ${color.years?.[1] ?? ''}`.trim();
  return null;
}

export default function PartsInfoPage() {
  const [query, setQuery] = useState('');

  const colors = useMemo(() => {
    const sorted = [...palette.colors].sort((a, b) => a.name.localeCompare(b.name));
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((c) => c.name.toLowerCase().includes(q)) : sorted;
  }, [query]);

  return (
    <section className="panel" aria-labelledby="parts-info-heading">
      <h2 id="parts-info-heading">
        Parts Info <span className="muted small">{palette.colors.length} colors</span>
      </h2>
      <p className="muted small">
        Every color LEGO makes these bricks in: its name, RGB value, a swatch, and the
        brick sizes it is actually produced in. Retired colors and non-solid finishes are
        included and labeled.
      </p>

      <div className="field">
        <label htmlFor="parts-info-search" className="visually-hidden">
          Filter colors by name
        </label>
        <input
          id="parts-info-search"
          type="search"
          placeholder="Filter by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="table-scroll">
        <table className="colors-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Swatch</span>
              </th>
              <th scope="col">Name</th>
              <th scope="col">Hex</th>
              <th scope="col">RGB</th>
              <th scope="col">Sizes available</th>
            </tr>
          </thead>
          <tbody>
            {colors.map((color) => {
              const note = aside(color);
              const [r, g, b] = color.rgb;
              return (
                <tr key={color.key} style={rowColorVars(color)}>
                  <td>
                    <span
                      className="colors-table__swatch"
                      style={{ background: color.hex }}
                      aria-hidden="true"
                    />
                  </td>
                  <td>
                    {color.name}
                    {note && <span className="muted small"> {note}</span>}
                  </td>
                  <td className="muted">{color.hex}</td>
                  <td className="muted">
                    {r}, {g}, {b}
                  </td>
                  <td className="muted">{color.shapes.map(sizeLabel).join(', ')}</td>
                </tr>
              );
            })}
            {colors.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No colors match &ldquo;{query}&rdquo;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
