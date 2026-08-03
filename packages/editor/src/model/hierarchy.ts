import type { EntityId, World } from '@nne/core';
import type { HierarchyNode } from '../types.js';

/**
 * Builds the Hierarchy tree from the `parent` field of every entity.
 * One pass to create the nodes, one to link them, so a child whose parent comes
 * later in the list still lands in the right place.
 */
export function buildHierarchy(world: World): HierarchyNode[] {
  const nodes = new Map<EntityId, HierarchyNode>();
  for (const id of world.entities()) {
    nodes.set(id, { id, name: world.getName(id), children: [] });
  }

  const roots: HierarchyNode[] = [];
  for (const id of world.entities()) {
    const node = nodes.get(id) as HierarchyNode;
    const parent = world.getParent(id);
    const parentNode = parent === null ? undefined : nodes.get(parent);
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Whether a drag&drop reparent would be accepted by the World.
 *
 * Asks the question the World answers with an exception. Without this the
 * Hierarchy would happily emit a command that throws mid-session, and a cycle
 * guard firing as an unhandled error is not a user interface.
 */
export function canReparent(
  world: World,
  entity: EntityId,
  parent: EntityId | null,
): boolean {
  if (!world.alive(entity)) return false;
  if (parent === null) return true;
  if (!world.alive(parent)) return false;
  // An entity cannot become a child of itself or of anything below it.
  return !world.subtree(entity).includes(parent);
}
