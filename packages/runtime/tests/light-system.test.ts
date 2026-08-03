import { beforeEach, describe, expect, it } from 'vitest';
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

  it('ignores entities the graph does not track', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    expect(() => system(world, 0.016)).not.toThrow();
  });
});
