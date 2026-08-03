import type { ReactElement } from 'react';
import { useStore } from 'zustand';
import type { EntityId } from '@nne/core';
import type { EditorStore } from '../store.js';
import type { HierarchyNode } from '../types.js';

interface Props {
  store: EditorStore;
  onSelect: (entity: EntityId | null) => void;
  onReparent: (entity: EntityId, parent: EntityId | null) => void;
}

function Node({ node, selection, onSelect, onReparent }: {
  node: HierarchyNode;
  selection: EntityId | null;
  onSelect: Props['onSelect'];
  onReparent: Props['onReparent'];
}): ReactElement {
  return (
    <li>
      <button
        type="button"
        className={node.id === selection ? 'row selected' : 'row'}
        draggable
        onClick={() => onSelect(node.id)}
        onDragStart={(e) => e.dataTransfer.setData('text/entity', String(node.id))}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const dragged = Number(e.dataTransfer.getData('text/entity'));
          if (Number.isFinite(dragged)) onReparent(dragged, node.id);
        }}
      >
        {node.name}
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Node
              key={child.id}
              node={child}
              selection={selection}
              onSelect={onSelect}
              onReparent={onReparent}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The scene tree. Reads the store; every change it makes goes through a command. */
export function Hierarchy({ store, onSelect, onReparent }: Props): ReactElement {
  const hierarchy = useStore(store, (s) => s.hierarchy);
  const selection = useStore(store, (s) => s.selection);

  return (
    <section className="panel hierarchy">
      <h2>Hierarchy</h2>
      <ul
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const dragged = Number(e.dataTransfer.getData('text/entity'));
          if (Number.isFinite(dragged)) onReparent(dragged, null);
        }}
      >
        {hierarchy.map((node) => (
          <Node
            key={node.id}
            node={node}
            selection={selection}
            onSelect={onSelect}
            onReparent={onReparent}
          />
        ))}
      </ul>
    </section>
  );
}
