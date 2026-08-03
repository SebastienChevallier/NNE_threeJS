import type {
  ComponentData, ComponentRegistry, ComponentType, FieldSpec, FieldType,
} from '@nne/core';

/** One row of the Inspector: everything a control needs, and nothing more. */
export interface FieldView {
  name: string;
  type: FieldType;
  value: unknown;
  /** For `enum` fields. */
  options?: readonly string[];
  /** For `asset` fields. */
  accept?: string;
}

/**
 * Turns a component's schema and data into the rows the Inspector renders.
 *
 * This is what keeps the Inspector free of per-component code: ten field types
 * mean ten controls, however many components the registry grows to hold.
 */
export function describeComponent(
  registry: ComponentRegistry,
  type: ComponentType,
  data: ComponentData,
): FieldView[] {
  const schema = registry.get(type);
  if (!schema) return [];

  return Object.entries(schema).map(([name, spec]) => {
    const view: FieldView = {
      name,
      type: spec.type,
      // `Object.hasOwn` rather than `in`: `in` walks the prototype chain, so a
      // field named `toString` would read as present on every object. A scene
      // written before a field existed simply shows the schema default.
      value: Object.hasOwn(data, name) ? data[name] : spec.default,
    };
    if (spec.options) view.options = spec.options;
    if (spec.accept) view.accept = spec.accept;
    return view;
  });
}

/** The `#rrggbb` form the colour field stores. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function toFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Validates a value coming out of a control, returning `undefined` to mean
 * "not a usable value — do not write it".
 *
 * UI input is untrusted in the same way disk input is. An empty number input
 * reads as `''`, and coercing that to `0` would silently destroy the value the
 * user is halfway through replacing. Refusing here keeps the invalid value from
 * ever reaching a command, let alone the scene file.
 */
export function coerceFieldValue(spec: FieldSpec, raw: unknown): unknown {
  switch (spec.type) {
    case 'number':
      return toFiniteNumber(raw);
    case 'int': {
      const value = toFiniteNumber(raw);
      return value === undefined ? undefined : Math.trunc(value);
    }
    case 'bool':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'string':
      return typeof raw === 'string' ? raw : undefined;
    case 'vec3':
    case 'euler': {
      if (!Array.isArray(raw) || raw.length !== 3) return undefined;
      const parts = raw.map(toFiniteNumber);
      return parts.every((p) => p !== undefined) ? parts : undefined;
    }
    case 'color':
      return typeof raw === 'string' && HEX_COLOR.test(raw) ? raw : undefined;
    case 'enum':
      return typeof raw === 'string' && spec.options?.includes(raw) ? raw : undefined;
    case 'asset':
      if (raw === null) return null;
      // An empty string is neither a path nor "no asset": it is a control that
      // has been cleared without committing to either.
      return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    case 'entity': {
      if (raw === null) return null;
      const value = toFiniteNumber(raw);
      return value === undefined ? undefined : Math.trunc(value);
    }
  }
}

/** The components "Add Component" should offer for an entity. */
export function addableComponents(
  registry: ComponentRegistry,
  present: readonly ComponentType[],
): ComponentType[] {
  return registry.list().filter((type) => !present.includes(type));
}
