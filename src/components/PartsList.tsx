import { useState } from 'react';
import { groupByColor } from '../lego/bom';
import { palette, type DerivedMosaic } from '../state/useMosaicStore';

export interface PartsListProps {
  derived: DerivedMosaic;
}

export default function PartsList({ derived }: PartsListProps) {
  const [open, setOpen] = useState<string | null>(null);
  if (!derived.bom) return null;

  const groups = groupByColor(derived.bom);

  return (
    <section className="panel" aria-labelledby="parts-heading">
      <h2 id="parts-heading">
        Parts <span className="muted small">{groups.length} colors</span>
      </h2>

      <ul className="parts">
        {groups.map((group) => {
          const color = palette.byKey.get(group.colorKey);
          const expanded = open === group.colorKey;
          return (
            <li key={group.colorKey}>
              <button
                type="button"
                className="parts__row"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : group.colorKey)}
              >
                <span
                  className="swatch__chip"
                  style={{ background: color?.hex ?? '#888' }}
                  aria-hidden="true"
                />
                <span className="parts__name">{group.colorName}</span>
                <span className="parts__qty">{group.quantity.toLocaleString()}</span>
                <span className="parts__caret" aria-hidden="true">
                  {expanded ? '−' : '+'}
                </span>
              </button>

              {expanded && (
                <table className="parts__detail">
                  <thead>
                    <tr>
                      <th scope="col">Part</th>
                      <th scope="col">ID</th>
                      <th scope="col">Element ID</th>
                      <th scope="col">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.lines.map((line) => (
                      <tr key={line.designId}>
                        <td>{line.partName.replace('Brick ', '')}</td>
                        <td className="muted">{line.designId}</td>
                        <td className="muted">{line.elementId ?? '—'}</td>
                        <td>{line.quantity.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
