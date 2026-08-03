import type { Object3D } from 'three';
import { MESH, type EntityId, type System } from '@nne/core';
import type { AssetCache } from '../assets.js';
import type { SceneGraph } from '../scene-graph.js';
import type { MeshData } from '../types.js';

/** What this system put in the graph for an entity, and the flags written on it. */
interface Attachment {
  object: Object3D;
  castShadow: boolean;
}

/**
 * Loads .glb assets for Mesh components and swaps them into the graph.
 *
 * The system itself stays synchronous: it starts a load, remembers which url is
 * in flight per entity, and attaches the result when the promise settles. An
 * entity despawned mid-load attaches nothing.
 */
export function createMeshSystem(graph: SceneGraph, assets: AssetCache): System {
  const resolved = new Map<EntityId, string>();
  const attached = new Map<EntityId, Attachment>();

  /** Writes castShadow onto a loaded object, skipping the traversal when unchanged. */
  const applyCastShadow = (attachment: Attachment, castShadow: boolean): void => {
    if (attachment.castShadow === castShadow) return;
    attachment.object.traverse((child) => { child.castShadow = castShadow; });
    attachment.castShadow = castShadow;
  };

  /** Stops mirroring an asset the component no longer asks for. */
  const release = (entity: EntityId): void => {
    const attachment = attached.get(entity);
    // Identity check: another system may own the entity's object by now, and
    // detaching a camera or a light here would delete something not ours.
    if (attachment && graph.objectOf(entity) === attachment.object) graph.detach(entity);
    attached.delete(entity);
    // Clearing this is what lets the same url load again if the mesh comes back.
    resolved.delete(entity);
  };

  return (world) => {
    for (const entity of world.query(MESH)) {
      const data = world.peek(entity, MESH) as unknown as MeshData;
      if (data.asset === null) {
        release(entity);
        continue;
      }

      if (resolved.get(entity) === data.asset) {
        // Same url, so nothing to reload — but castShadow may have changed
        // since, and the component stays the source of truth.
        const attachment = attached.get(entity);
        if (attachment) applyCastShadow(attachment, data.castShadow);
        continue;
      }

      resolved.set(entity, data.asset);
      const url = data.asset;

      void assets.get(url).then((object) => {
        // The entity may have been despawned, lost its Mesh component, or
        // pointed at another asset, while the load was in flight.
        if (!world.alive(entity) || resolved.get(entity) !== url) return;
        // Re-peek the current component: castShadow may have changed while
        // the load was in flight (same url, so the guard above didn't catch it).
        const current = world.peek(entity, MESH) as unknown as MeshData;
        object.traverse((child) => { child.castShadow = current.castShadow; });
        attached.set(entity, { object, castShadow: current.castShadow });
        graph.attach(entity, object);
      }).catch((error) => {
        // Only roll back if this load is still the one "in flight" for the
        // entity; a newer load may have already superseded it.
        if (resolved.get(entity) === url) resolved.delete(entity);
        console.error(`mesh-system: failed to load asset "${url}" for entity ${entity}`, error);
      });
    }

    // Deleting from a Map while iterating its own keys is well-defined in JS.
    for (const entity of resolved.keys()) {
      // An entity can lose its Mesh component while staying alive: it drops out
      // of the query, but the loaded object would keep rendering regardless.
      if (!world.alive(entity) || !world.has(entity, MESH)) release(entity);
    }
  };
}
