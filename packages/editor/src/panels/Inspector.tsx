import type { ReactElement } from 'react';
import { useStore } from 'zustand';
import type { ComponentType } from '@nne/core';
import { addableComponents, describeComponent, type FieldView } from '../model/fields.js';
import type { EditorStore } from '../store.js';

interface Props {
  store: EditorStore;
  /** Field specs come from the registry; the Inspector never knows a component. */
  describe: (type: ComponentType, data: Record<string, unknown>) => FieldView[];
  addable: (present: ComponentType[]) => ComponentType[];
  onFieldChange: (type: ComponentType, field: string, raw: unknown) => void;
  onAddComponent: (type: ComponentType) => void;
  onRemoveComponent: (type: ComponentType) => void;
  onRename: (name: string) => void;
}

/** One control per field type. Ten types, ten controls, any number of components. */
function Field({ field, onChange }: {
  field: FieldView;
  onChange: (raw: unknown) => void;
}): ReactElement {
  switch (field.type) {
    case 'bool':
      return (
        <input
          type="checkbox"
          checked={field.value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'vec3':
    case 'euler': {
      const parts = Array.isArray(field.value) ? (field.value as number[]) : [0, 0, 0];
      return (
        <span className="vec3">
          {[0, 1, 2].map((axis) => (
            <input
              key={axis}
              type="number"
              value={String(parts[axis] ?? 0)}
              onChange={(e) => {
                const next = [...parts.map(String)];
                next[axis] = e.target.value;
                onChange(next);
              }}
            />
          ))}
        </span>
      );
    }
    case 'enum':
      return (
        <select value={String(field.value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    case 'color':
      return (
        <input
          type="color"
          value={String(field.value ?? '#ffffff')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
    case 'int':
    case 'entity':
      return (
        <input
          type="number"
          value={field.value === null ? '' : String(field.value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          type="text"
          value={field.value === null ? '' : String(field.value ?? '')}
          onChange={(e) => onChange(e.target.value === '' && field.type === 'asset' ? null : e.target.value)}
        />
      );
  }
}

export function Inspector(props: Props): ReactElement {
  const entity = useStore(props.store, (s) => s.entity);

  if (!entity) {
    return <section className="panel inspector"><h2>Inspector</h2><p>No selection</p></section>;
  }

  const present = entity.components.map((c) => c.type);

  return (
    <section className="panel inspector">
      <h2>Inspector</h2>
      <header>
        <input
          value={entity.name}
          onChange={(e) => props.onRename(e.target.value)}
        />
        <span className="entity-id">#{entity.id}</span>
      </header>

      {entity.components.map((component) => (
        <details key={component.type} open>
          <summary>
            {component.type}
            <button type="button" onClick={() => props.onRemoveComponent(component.type)}>
              Remove
            </button>
          </summary>
          {props.describe(component.type, component.data).map((field) => (
            <label key={field.name}>
              <span>{field.name}</span>
              <Field
                field={field}
                onChange={(raw) => props.onFieldChange(component.type, field.name, raw)}
              />
            </label>
          ))}
        </details>
      ))}

      <footer>
        <select
          value=""
          onChange={(e) => { if (e.target.value) props.onAddComponent(e.target.value); }}
        >
          <option value="">Add Component…</option>
          {props.addable(present).map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </footer>
    </section>
  );
}

export { addableComponents, describeComponent };
