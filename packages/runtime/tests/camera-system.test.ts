import { beforeEach, describe, expect, it } from 'vitest';
import { Object3D, PerspectiveCamera } from 'three';
import { CAMERA, World } from '@nne/core';
import { SceneGraph } from '../src/scene-graph.js';
import { createCameraSystem } from '../src/systems/camera-system.js';

describe('camera system', () => {
  let graph: SceneGraph;
  let world: World;
  let system: ReturnType<typeof createCameraSystem>;

  beforeEach(() => {
    graph = new SceneGraph(new Object3D());
    world = new World();
    system = createCameraSystem(graph);
  });

  const camera = { fov: 60, near: 0.1, far: 1000, active: true };

  it('has no active camera before running', () => {
    expect(system.active()).toBeUndefined();
  });

  it('attaches a PerspectiveCamera for a Camera component', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    expect(graph.objectOf(e)).toBeInstanceOf(PerspectiveCamera);
  });

  it('exposes the active camera', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    expect(system.active()).toBe(graph.objectOf(e));
  });

  it('applies fov, near and far', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, { fov: 75, near: 0.5, far: 500, active: true });
    graph.sync(world);
    system(world, 0.016);
    const active = system.active() as PerspectiveCamera;
    expect([active.fov, active.near, active.far]).toEqual([75, 0.5, 500]);
  });

  it('follows a fov change without recreating the camera', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    const first = system.active();
    world.set(e, CAMERA, { ...camera, fov: 30 });
    system(world, 0.016);
    expect(system.active()).toBe(first);
    expect((system.active() as PerspectiveCamera).fov).toBe(30);
  });

  it('ignores an inactive camera', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, { ...camera, active: false });
    graph.sync(world);
    system(world, 0.016);
    expect(system.active()).toBeUndefined();
  });

  it('picks the lowest entity id when several are active', () => {
    const first = world.spawn('Cam1');
    const second = world.spawn('Cam2');
    world.set(second, CAMERA, camera);
    world.set(first, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    expect(system.active()).toBe(graph.objectOf(first));
  });

  it('drops the camera when the component is removed', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    const created = graph.objectOf(e) as PerspectiveCamera;

    world.remove(e, CAMERA);
    system(world, 0.016);

    expect(system.active()).toBeUndefined();
    expect(created.parent).toBeNull();
    expect(graph.objectOf(e)).toBeUndefined();

    graph.sync(world);
    expect(graph.objectOf(e)).not.toBeInstanceOf(PerspectiveCamera);
  });

  it('drops the active camera when its entity is despawned', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    world.despawn(e);
    graph.sync(world);
    system(world, 0.016);
    expect(system.active()).toBeUndefined();
  });
});
