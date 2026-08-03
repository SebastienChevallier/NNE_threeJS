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

      // Releases the shadow map's render target. `dispose` exists on the Light
      // base class, so it is safe for AmbientLight too.
      existing?.dispose();

      const light = createLight(data);
      lights.set(entity, light);
      graph.attach(entity, light);
    }

    // Deleting from a Map while iterating its own keys is well-defined in JS.
    for (const [entity, light] of lights) {
      // An entity can lose its Light component while staying alive: it drops
      // out of the query, but the object would keep lighting the scene.
      if (world.alive(entity) && world.has(entity, LIGHT)) continue;
      light.dispose();
      // Drop the object from the graph too, otherwise it stays in the tree.
      // `sync` recreates a plain placeholder next tick for a live entity.
      if (graph.objectOf(entity) === light) graph.detach(entity);
      lights.delete(entity);
    }
  };
}
