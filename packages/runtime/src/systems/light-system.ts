import type { Light } from 'three';
import { LIGHT, type EntityId, type System } from '@nne/core';
import { applyLight, createLight } from '../convert.js';
import type { SceneGraph } from '../scene-graph.js';
import type { LightData } from '../types.js';

/**
 * Keeps a three.js light in sync with each Light component.
 * Light types are separate classes, so changing `type` recreates the object
 * rather than mutating it.
 */
export function createLightSystem(graph: SceneGraph): System {
  const lights = new Map<EntityId, Light>();

  return (world) => {
    for (const entity of world.query(LIGHT)) {
      if (!graph.objectOf(entity)) continue;
      const data = world.peek(entity, LIGHT) as unknown as LightData;

      const existing = lights.get(entity);
      if (existing && applyLight(existing, data)) continue;

      const light = createLight(data);
      lights.set(entity, light);
      graph.attach(entity, light);
    }

    for (const entity of [...lights.keys()]) {
      if (!world.alive(entity)) lights.delete(entity);
    }
  };
}
