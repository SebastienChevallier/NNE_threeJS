import { MESH, type EntityId, type System } from '@nne/core';
import type { AssetCache } from '../assets.js';
import type { SceneGraph } from '../scene-graph.js';
import type { MeshData } from '../types.js';

/**
 * Loads .glb assets for Mesh components and swaps them into the graph.
 *
 * The system itself stays synchronous: it starts a load, remembers which url is
 * in flight per entity, and attaches the result when the promise settles. An
 * entity despawned mid-load attaches nothing.
 */
export function createMeshSystem(graph: SceneGraph, assets: AssetCache): System {
  const resolved = new Map<EntityId, string>();

  return (world) => {
    for (const entity of world.query(MESH)) {
      const data = world.peek(entity, MESH) as unknown as MeshData;
      if (data.asset === null) continue;
      if (resolved.get(entity) === data.asset) continue;

      resolved.set(entity, data.asset);
      const url = data.asset;

      void assets.get(url).then((object) => {
        // The entity may have been despawned, or pointed at another asset,
        // while the load was in flight.
        if (!world.alive(entity) || resolved.get(entity) !== url) return;
        // Re-peek the current component: castShadow may have changed while
        // the load was in flight (same url, so the guard above didn't catch it).
        const current = world.peek(entity, MESH) as unknown as MeshData;
        object.traverse((child) => { child.castShadow = current.castShadow; });
        graph.attach(entity, object);
      }).catch((error) => {
        // Only roll back if this load is still the one "in flight" for the
        // entity; a newer load may have already superseded it.
        if (resolved.get(entity) === url) resolved.delete(entity);
        console.error(`mesh-system: failed to load asset "${url}" for entity ${entity}`, error);
      });
    }

    for (const entity of resolved.keys()) {
      if (!world.alive(entity)) resolved.delete(entity);
    }
  };
}
