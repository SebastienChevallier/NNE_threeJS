import { beforeEach, describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { TRANSFORM, World } from '@nne/core';
import { SceneGraph } from '../src/scene-graph.js';
import { createTransformSystem } from '../src/systems/transform-system.js';

describe('transform system', () => {
  let root: Object3D;
  let graph: SceneGraph;
  let world: World;
  let system: ReturnType<typeof createTransformSystem>;

  beforeEach(() => {
    root = new Object3D();
    graph = new SceneGraph(root);
    world = new World();
    system = createTransformSystem(graph);
  });

  const identity = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

  it('writes the transform onto the mirrored object', () => {
    const e = world.spawn('A');
    world.set(e, TRANSFORM, { ...identity, position: [1, 2, 3] });
    graph.sync(world);
    system(world, 0.016);
    expect(graph.objectOf(e)?.position.toArray()).toEqual([1, 2, 3]);
  });

  it('ignores entities without a Transform', () => {
    const e = world.spawn('A');
    graph.sync(world);
    expect(() => system(world, 0.016)).not.toThrow();
    expect(graph.objectOf(e)?.position.toArray()).toEqual([0, 0, 0]);
  });

  it('ignores entities the graph does not track', () => {
    const e = world.spawn('A');
    world.set(e, TRANSFORM, identity);
    expect(() => system(world, 0.016)).not.toThrow();
  });

  it('follows a component change on the next run', () => {
    const e = world.spawn('A');
    world.set(e, TRANSFORM, identity);
    graph.sync(world);
    system(world, 0.016);
    world.set(e, TRANSFORM, { ...identity, position: [9, 9, 9] });
    system(world, 0.016);
    expect(graph.objectOf(e)?.position.toArray()).toEqual([9, 9, 9]);
  });

  it('never writes back into the component', () => {
    const e = world.spawn('A');
    world.set(e, TRANSFORM, identity);
    graph.sync(world);
    const object = graph.objectOf(e) as Object3D;
    object.position.set(7, 7, 7);
    system(world, 0.016);
    expect(world.get(e, TRANSFORM)).toEqual(identity);
  });

  it('applies transforms to a whole hierarchy', () => {
    const parent = world.spawn('P');
    const child = world.spawn('C', parent);
    world.set(parent, TRANSFORM, { ...identity, position: [1, 0, 0] });
    world.set(child, TRANSFORM, { ...identity, position: [0, 1, 0] });
    graph.sync(world);
    system(world, 0.016);
    expect(graph.objectOf(parent)?.position.toArray()).toEqual([1, 0, 0]);
    expect(graph.objectOf(child)?.position.toArray()).toEqual([0, 1, 0]);
  });
});
