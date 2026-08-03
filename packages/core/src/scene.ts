import { World } from './world.js';
import type { ComponentData, ComponentType, EntityId, ValidationError } from './types.js';
import { isPlainRecord } from './types.js';
import type { ComponentRegistry } from './registry.js';

export const SCENE_VERSION = 1;

export interface SceneEntity {
  id: EntityId;
  name: string;
  /** Absent when the entity sits at the scene root. */
  parent?: EntityId;
  components: Record<ComponentType, ComponentData>;
}

export interface SceneFile {
  version: number;
  name: string;
  entities: SceneEntity[];
}

export function serializeScene(world: World, name: string): SceneFile {
  const entities: SceneEntity[] = world.entities().map((id) => {
    const parent = world.getParent(id);
    const entity: SceneEntity = {
      id,
      name: world.getName(id),
      components: world.componentsOf(id),
    };
    if (parent !== null) entity.parent = parent;
    return entity;
  });
  return { version: SCENE_VERSION, name, entities };
}

export function deserializeScene(file: SceneFile): World {
  const world = new World();
  // Two passes: every entity must exist before any parent link is set,
  // because a child may be declared before its parent in the file.
  const sorted = [...file.entities].sort((a, b) => a.id - b.id);
  for (const entity of sorted) {
    world.spawnWithId(entity.id, entity.name, null);
    for (const [type, data] of Object.entries(entity.components)) {
      world.set(entity.id, type, data);
    }
  }
  for (const entity of sorted) {
    if (entity.parent !== undefined) world.setParent(entity.id, entity.parent);
  }
  return world;
}

/**
 * Deterministic JSON: sorted component keys, stable field order, two-space
 * indent, trailing newline. Keeps git diffs on scenes small and readable.
 */
export function stringifyScene(file: SceneFile): string {
  const normalized: SceneFile = {
    version: file.version,
    name: file.name,
    entities: [...file.entities]
      .sort((a, b) => a.id - b.id)
      .map((entity) => {
        const components: Record<ComponentType, ComponentData> = {};
        for (const type of Object.keys(entity.components).sort()) {
          components[type] = entity.components[type] as ComponentData;
        }
        const out: SceneEntity = { id: entity.id, name: entity.name, components };
        if (entity.parent !== undefined) {
          return { id: out.id, name: out.name, parent: entity.parent, components };
        }
        return out;
      }),
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

/**
 * Checks a parsed scene file before it is loaded into a World.
 * Returns every problem found; an empty array means the file is safe to load.
 */
export function validateScene(file: unknown, registry: ComponentRegistry): ValidationError[] {
  if (!isPlainRecord(file)) {
    return [{ path: 'scene', message: 'expected an object' }];
  }
  const errors: ValidationError[] = [];
  const scene = file as Record<string, unknown>;

  if (scene.version !== SCENE_VERSION) {
    errors.push({ path: 'scene.version', message: `expected version ${SCENE_VERSION}` });
  }
  if (typeof scene.name !== 'string') {
    errors.push({ path: 'scene.name', message: 'expected a string' });
  }
  if (!Array.isArray(scene.entities)) {
    errors.push({ path: 'scene.entities', message: 'expected an array' });
    return errors;
  }

  const seen = new Set<number>();
  const raw = scene.entities as unknown[];

  for (const [index, value] of raw.entries()) {
    const base = `scene.entities[${index}]`;
    if (!isPlainRecord(value)) {
      errors.push({ path: base, message: 'expected an object' });
      continue;
    }
    const entity = value as Record<string, unknown>;

    if (typeof entity.id !== 'number' || !Number.isInteger(entity.id) || entity.id < 1) {
      errors.push({ path: `${base}.id`, message: 'expected a positive integer' });
    } else if (seen.has(entity.id)) {
      errors.push({ path: `${base}.id`, message: `duplicate entity id ${entity.id}` });
    } else {
      seen.add(entity.id);
    }

    if (typeof entity.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'expected a string' });
    }

    const components = entity.components;
    if (!isPlainRecord(components)) {
      errors.push({ path: `${base}.components`, message: 'expected an object' });
      continue;
    }
    for (const [type, data] of Object.entries(components as Record<string, unknown>)) {
      if (!registry.has(type)) {
        errors.push({ path: `${base}.components.${type}`, message: 'unknown component type' });
        continue;
      }
      for (const error of registry.validate(type, data)) {
        // registry paths look like "Mesh.castShadow"; re-anchor them on the entity.
        const suffix = error.path.slice(type.length);
        errors.push({ path: `${base}.components.${type}${suffix}`, message: error.message });
      }
    }
  }

  // Parents are checked last, once every declared id is known.
  const parentOf = new Map<number, number>();
  for (const [index, value] of raw.entries()) {
    if (!isPlainRecord(value)) continue;
    const entity = value;
    if (entity.parent === undefined) continue;
    if (typeof entity.parent !== 'number' || !seen.has(entity.parent)) {
      errors.push({
        path: `scene.entities[${index}].parent`,
        message: `unknown parent entity ${String(entity.parent)}`,
      });
    } else if (typeof entity.id === 'number') {
      parentOf.set(entity.id, entity.parent);
    }
  }

  // Cycle detection: only over parent links already known to resolve, so a
  // dangling parent (reported above) never masks a real cycle. One pass per
  // entity, but each id is walked at most once overall thanks to `resolved` /
  // `visiting`, keeping the whole check O(n).
  const resolved = new Set<number>();
  for (const id of seen) {
    if (resolved.has(id)) continue;
    const path: number[] = [];
    const indexOnPath = new Map<number, number>();
    let current: number | undefined = id;
    while (current !== undefined && !resolved.has(current)) {
      const seenAt = indexOnPath.get(current);
      if (seenAt !== undefined) {
        // Only the ids from the first repeat onward form the actual cycle;
        // earlier ids on the path merely lead into it and are unaffected.
        for (const cycled of path.slice(seenAt)) {
          const index = raw.findIndex(
            (value) => isPlainRecord(value) && value.id === cycled,
          );
          errors.push({
            path: `scene.entities[${index}].parent`,
            message: 'parent cycle detected',
          });
        }
        break;
      }
      indexOnPath.set(current, path.length);
      path.push(current);
      current = parentOf.get(current);
    }
    for (const done of path) resolved.add(done);
  }

  return errors;
}
