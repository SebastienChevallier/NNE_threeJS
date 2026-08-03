import type { Vector3 } from 'three';
import { MESH, TRANSFORM, type EntityId } from '@nne/core';
import type { EditorSession } from '../session.js';
import type { AssetSummary } from '../types.js';

/** A picking ray: what the raycaster gives, without depending on its class. */
export interface Ray {
  origin: Vector3;
  direction: Vector3;
}

type Vec3 = [number, number, number];

/** How far ahead to drop when the ray never meets the ground. */
const DEFAULT_FALLBACK_DISTANCE = 10;

/**
 * Where a dragged asset should land: the ray's intersection with the ground
 * plane (y = 0), or a point straight ahead when there is none.
 *
 * Aiming at the horizon or the sky never meets the ground, and so does a camera
 * looking away from it. Dropping at the origin in those cases is baffling —
 * the object appears somewhere the user was not looking. A fixed distance
 * ahead is what they meant.
 */
export function groundDropPoint(ray: Ray, fallbackDistance = DEFAULT_FALLBACK_DISTANCE): Vec3 {
  const ahead = (): Vec3 => [
    ray.origin.x + ray.direction.x * fallbackDistance,
    ray.origin.y + ray.direction.y * fallbackDistance,
    ray.origin.z + ray.direction.z * fallbackDistance,
  ];

  // Parallel to the plane: no intersection, however far the ray runs.
  if (ray.direction.y === 0) return ahead();

  const distance = -ray.origin.y / ray.direction.y;
  // Negative means the plane is behind the camera; the ray goes the other way.
  if (distance <= 0) return ahead();

  return [
    ray.origin.x + ray.direction.x * distance,
    0,
    ray.origin.z + ray.direction.z * distance,
  ];
}

/** "props/PRP_Chair.v2.glb" -> "PRP_Chair.v2". Only the extension goes. */
function entityNameFor(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.glb$/i, '');
}

/**
 * Drops an asset into the scene: one entity carrying a Transform at the drop
 * point and a Mesh pointing at the asset.
 *
 * Three commands, so three undo steps. Accepted for V1 and noted in the plan:
 * collapsing them into one would mean adding an atomic batch to `core`'s
 * command layer, which the spec does not ask for.
 */
export function dropAsset(
  session: EditorSession,
  asset: AssetSummary,
  point: Vec3,
): EntityId {
  const entity = session.spawnEntity(entityNameFor(asset.path), null);

  session.dispatch({
    kind: 'AddComponent',
    entity,
    type: TRANSFORM,
    data: { position: point, rotation: [0, 0, 0], scale: [1, 1, 1] },
  });
  session.dispatch({
    kind: 'AddComponent',
    entity,
    type: MESH,
    data: { asset: asset.path, castShadow: true },
  });

  return entity;
}
