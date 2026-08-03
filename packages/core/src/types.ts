/** A unique, stable, persisted identifier for an entity. */
export type EntityId = number;

/** The name a component is registered under, e.g. "Transform". */
export type ComponentType = string;

/** The ten field types the Inspector knows how to render. */
export type FieldType =
  | 'number'
  | 'int'
  | 'bool'
  | 'string'
  | 'vec3'
  | 'euler'
  | 'color'
  | 'enum'
  | 'asset'
  | 'entity';

/** The declaration of a single field inside a component schema. */
export interface FieldSpec {
  type: FieldType;
  /** Value used when the component is added, and when a field is missing. */
  default: unknown;
  /** For `asset` fields: a file extension filter such as ".glb". */
  accept?: string;
  /** For `enum` fields: the allowed values. */
  options?: readonly string[];
}

/** The full declaration of a component type: its fields, in declaration order. */
export type ComponentSchema = Record<string, FieldSpec>;

/** The runtime payload of a component instance. Always JSON-serializable. */
export type ComponentData = Record<string, unknown>;

/** A single validation failure, with a dotted path to the offending value. */
export interface ValidationError {
  path: string;
  message: string;
}
