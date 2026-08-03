import type { Object3D } from 'three';
import type { EntityId } from '@nne/core';

/** The part of three's Intersection this module needs. */
export interface Intersection {
  distance: number;
  object: Object3D;
}

/**
 * The entity an object belongs to, walking up the tree until one is found.
 *
 * A loaded .glb is a subtree and only its root carries `userData.entity`, so a
 * raycast — which hits a leaf — has to climb. Without this, clicking a chair
 * selects its armrest.
 */
export function entityOf(object: Object3D): EntityId | undefined {
  let current: Object3D | null = object;
  while (current) {
    const entity: unknown = current.userData['entity'];
    if (typeof entity === 'number') return entity;
    current = current.parent;
  }
  return undefined;
}

/**
 * The entity under the cursor: the nearest hit that belongs to one.
 *
 * Hits that belong to no entity are skipped rather than ending the search — the
 * grid and the helpers live in the same scene, and clicking through the grid
 * should select what is behind it, not clear the selection.
 */
export function pickEntity(hits: readonly Intersection[]): EntityId | undefined {
  // Sorted defensively: three returns hits nearest-first, but relying on that
  // silently makes this function wrong for any other caller.
  const ordered = [...hits].sort((a, b) => a.distance - b.distance);
  for (const hit of ordered) {
    const entity = entityOf(hit.object);
    if (entity !== undefined) return entity;
  }
  return undefined;
}
