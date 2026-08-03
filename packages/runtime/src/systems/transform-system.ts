import { TRANSFORM, type System } from '@nne/core';
import type { SceneGraph } from '../scene-graph.js';
import { applyTransform } from '../convert.js';
import type { TransformData } from '../types.js';

/**
 * Copies Transform components onto their mirrored objects, once per frame.
 * Uses `peek` rather than `get`: this runs for every entity, every frame, and
 * `get`'s defensive copy would dominate the frame budget.
 */
export function createTransformSystem(graph: SceneGraph): System {
  return (world) => {
    for (const entity of world.query(TRANSFORM)) {
      const object = graph.objectOf(entity);
      if (!object) continue;
      applyTransform(object, world.peek(entity, TRANSFORM) as unknown as TransformData);
    }
  };
}
