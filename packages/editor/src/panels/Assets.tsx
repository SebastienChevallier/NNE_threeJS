import { useState } from 'react';
import type { ReactElement } from 'react';
import { useStore } from 'zustand';
import type { EditorStore } from '../store.js';
import type { AssetSummary } from '../types.js';

interface Props {
  store: EditorStore;
  onDragStart: (asset: AssetSummary) => void;
}

/** The asset grid, filterable by name and category. Fed entirely by the server. */
export function Assets({ store, onDragStart }: Props): ReactElement {
  const assets = useStore(store, (s) => s.assets);
  const [filter, setFilter] = useState('');

  const needle = filter.trim().toLowerCase();
  const shown = needle === ''
    ? assets
    : assets.filter((a) =>
      a.path.toLowerCase().includes(needle) || a.category.toLowerCase().includes(needle));

  return (
    <section className="panel assets">
      <h2>Assets</h2>
      <input
        type="search"
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="grid">
        {shown.map((asset) => (
          <li
            key={asset.path}
            draggable
            onDragStart={() => onDragStart(asset)}
            title={`${asset.path} — ${asset.triangles} tris`}
          >
            {asset.thumbnailUrl
              ? <img src={asset.thumbnailUrl} alt="" />
              : <span className="category-icon">{asset.category}</span>}
            <span className="name">{asset.path.split('/').pop()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
