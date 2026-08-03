import { World } from './world.js';
import type { ComponentData, ComponentType, EntityId } from './types.js';

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
