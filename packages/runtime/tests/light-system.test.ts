import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectionalLight, Object3D, PointLight } from 'three';
import { LIGHT, World } from '@nne/core';
import { SceneGraph } from '../src/scene-graph.js';
import { createLightSystem } from '../src/systems/light-system.js';

describe('light system', () => {
  let graph: SceneGraph;
  let world: World;
  let system: ReturnType<typeof createLightSystem>;

  beforeEach(() => {
    graph = new SceneGraph(new Object3D());
    world = new World();
    system = createLightSystem(graph);
  });

  const light = { type: 'directional', color: '#ffffff', intensity: 1 };

  it('attaches a light object', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    expect(graph.objectOf(e)).toBeInstanceOf(DirectionalLight);
  });

  it('applies colour and intensity', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, { ...light, color: '#ff0000', intensity: 4 });
    graph.sync(world);
    system(world, 0.016);
    const created = graph.objectOf(e) as DirectionalLight;
    expect(created.color.getHexString()).toBe('ff0000');
    expect(created.intensity).toBe(4);
  });

  it('updates in place when only intensity changes', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    const first = graph.objectOf(e);
    world.set(e, LIGHT, { ...light, intensity: 9 });
    system(world, 0.016);
    expect(graph.objectOf(e)).toBe(first);
    expect((graph.objectOf(e) as DirectionalLight).intensity).toBe(9);
  });

  it('recreates the object when the light type changes', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    world.set(e, LIGHT, { ...light, type: 'point' });
    system(world, 0.016);
    expect(graph.objectOf(e)).toBeInstanceOf(PointLight);
  });

  it('disposes the old light when the type changes', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    const first = graph.objectOf(e) as DirectionalLight;
    const disposed = vi.spyOn(first, 'dispose');
    world.set(e, LIGHT, { ...light, type: 'point' });
    system(world, 0.016);
    expect(disposed).toHaveBeenCalledOnce();
  });

  it('disposes and drops the light when the entity is despawned', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    const created = graph.objectOf(e) as DirectionalLight;
    const disposed = vi.spyOn(created, 'dispose');
    world.despawn(e);
    system(world, 0.016);
    expect(disposed).toHaveBeenCalledOnce();
  });

  it('disposes and unlights the entity when the component is removed', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    const created = graph.objectOf(e) as DirectionalLight;
    const disposed = vi.spyOn(created, 'dispose');

    world.remove(e, LIGHT);
    system(world, 0.016);

    expect(disposed).toHaveBeenCalledOnce();
    expect(created.parent).toBeNull();
    expect(graph.objectOf(e)).toBeUndefined();

    // The next sync gives the still-live entity a plain placeholder back.
    graph.sync(world);
    const placeholder = graph.objectOf(e);
    expect(placeholder).toBeInstanceOf(Object3D);
    expect(placeholder).not.toBeInstanceOf(DirectionalLight);
  });

  it('recreates a light when the component comes back', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    world.remove(e, LIGHT);
    system(world, 0.016);
    graph.sync(world);
    world.set(e, LIGHT, light);
    system(world, 0.016);
    expect(graph.objectOf(e)).toBeInstanceOf(DirectionalLight);
  });

  it('ignores entities the graph does not track', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    expect(() => system(world, 0.016)).not.toThrow();
  });
});
