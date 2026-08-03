import { PerspectiveCamera } from 'three';
import { CAMERA, type EntityId, type System, type World } from '@nne/core';
import type { SceneGraph } from '../scene-graph.js';
import type { CameraData } from '../types.js';

export interface CameraSystem extends System {
  /** The camera the renderer should draw through, if any. */
  active(): PerspectiveCamera | undefined;
}

/**
 * Keeps a PerspectiveCamera in sync with each Camera component, and tracks
 * which one is active. When several are active the lowest entity id wins:
 * arbitrary, but deterministic, so a scene renders the same way every load.
 */
export function createCameraSystem(graph: SceneGraph): CameraSystem {
  const cameras = new Map<EntityId, PerspectiveCamera>();
  let activeEntity: EntityId | undefined;

  const system: CameraSystem = Object.assign((world: World) => {
    activeEntity = undefined;

    for (const entity of world.query(CAMERA)) {
      if (!graph.objectOf(entity)) continue;
      const data = world.peek(entity, CAMERA) as unknown as CameraData;

      let camera = cameras.get(entity);
      if (!camera) {
        camera = new PerspectiveCamera(data.fov, 1, data.near, data.far);
        cameras.set(entity, camera);
        graph.attach(entity, camera);
      }

      camera.fov = data.fov;
      camera.near = data.near;
      camera.far = data.far;
      camera.updateProjectionMatrix();

      if (data.active && (activeEntity === undefined || entity < activeEntity)) {
        activeEntity = entity;
      }
    }

    // Deleting from a Map while iterating its own keys is well-defined in JS.
    for (const [entity, camera] of cameras) {
      // An entity can lose its Camera component while staying alive: it drops
      // out of the query, so the camera must not linger in the graph either.
      if (world.alive(entity) && world.has(entity, CAMERA)) continue;
      if (graph.objectOf(entity) === camera) graph.detach(entity);
      cameras.delete(entity);
    }
  }, {
    active: () => (activeEntity === undefined ? undefined : cameras.get(activeEntity)),
  });

  return system;
}
