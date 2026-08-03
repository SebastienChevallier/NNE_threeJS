import type {
  ComponentData,
  ComponentSchema,
  ComponentType,
  FieldSpec,
  FieldType,
  ValidationError,
} from './types.js';

/** The only field types the engine and the Inspector understand. */
export const FIELD_TYPES: readonly FieldType[] = [
  'number', 'int', 'bool', 'string', 'vec3',
  'euler', 'color', 'enum', 'asset', 'entity',
];

/**
 * Single source of truth for component shapes.
 * Feeds the Inspector, scene validation, default values and the build's
 * asset dependency graph.
 */
export class ComponentRegistry {
  private readonly schemas = new Map<ComponentType, ComponentSchema>();

  define(type: ComponentType, schema: ComponentSchema): void {
    if (this.schemas.has(type)) {
      throw new Error(`component "${type}" is already defined`);
    }
    for (const [field, spec] of Object.entries(schema)) {
      if (!FIELD_TYPES.includes(spec.type)) {
        throw new Error(`unknown field type "${spec.type}" on "${type}.${field}"`);
      }
      if (spec.type === 'enum') {
        if (!spec.options || spec.options.length === 0) {
          throw new Error(`enum field "${field}" needs options on "${type}"`);
        }
        if (!spec.options.includes(spec.default as string)) {
          throw new Error(
            `default "${String(spec.default)}" is not among options on "${type}.${field}"`,
          );
        }
      }
    }
    this.freezeSchema(schema);
    this.schemas.set(type, schema);
  }

  private freezeSchema(schema: ComponentSchema): void {
    for (const spec of Object.values(schema)) {
      if (spec.options) {
        Object.freeze(spec.options);
      }
      Object.freeze(spec);
    }
    Object.freeze(schema);
  }

  get(type: ComponentType): ComponentSchema | undefined {
    return this.schemas.get(type);
  }

  has(type: ComponentType): boolean {
    return this.schemas.has(type);
  }

  list(): ComponentType[] {
    return [...this.schemas.keys()].sort();
  }

  createDefault(type: ComponentType): ComponentData {
    const schema = this.schemas.get(type);
    if (!schema) throw new Error(`unknown component type "${type}"`);
    const out: ComponentData = {};
    for (const [field, spec] of Object.entries(schema)) {
      out[field] = structuredClone(spec.default);
    }
    return out;
  }

  /** Returns every problem found in `data`. An empty array means valid. */
  validate(type: ComponentType, data: unknown): ValidationError[] {
    const schema = this.schemas.get(type);
    if (!schema) return [{ path: type, message: 'unknown component type' }];
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return [{ path: type, message: 'expected an object' }];
    }

    const errors: ValidationError[] = [];
    const record = data as Record<string, unknown>;

    for (const [field, spec] of Object.entries(schema)) {
      const path = `${type}.${field}`;
      if (!(field in record)) {
        errors.push({ path, message: 'missing field' });
        continue;
      }
      const message = checkField(spec, record[field]);
      if (message) errors.push({ path, message });
    }
    for (const field of Object.keys(record)) {
      if (!(field in schema)) {
        errors.push({ path: `${type}.${field}`, message: 'unknown field' });
      }
    }
    return errors;
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isTriple(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Returns an error message, or null when the value fits the spec. */
function checkField(spec: FieldSpec, value: unknown): string | null {
  switch (spec.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null : 'expected a finite number';
    case 'int':
      return typeof value === 'number' && Number.isInteger(value)
        ? null : 'expected an integer';
    case 'bool':
      return typeof value === 'boolean' ? null : 'expected a boolean';
    case 'string':
      return typeof value === 'string' ? null : 'expected a string';
    case 'vec3':
    case 'euler':
      return isTriple(value) ? null : 'expected an array of 3 finite numbers';
    case 'color':
      return typeof value === 'string' && HEX_COLOR.test(value)
        ? null : 'expected a hex color such as #ff0000';
    case 'enum':
      return (spec.options ?? []).includes(value as string)
        ? null : `expected one of: ${(spec.options ?? []).join(', ')}`;
    case 'asset':
      return value === null || typeof value === 'string'
        ? null : 'expected an asset path or null';
    case 'entity':
      return value === null || (typeof value === 'number' && Number.isInteger(value))
        ? null : 'expected an entity id or null';
  }
}
