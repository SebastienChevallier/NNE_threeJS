import type {
  ComponentData,
  ComponentSchema,
  ComponentType,
  FieldType,
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
}
