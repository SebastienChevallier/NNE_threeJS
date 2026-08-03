import { beforeEach, describe, expect, it } from 'vitest';
import { Mesh, Object3D } from 'three';
import { MESH, World } from '@nne/core';
import { AssetCache } from '../src/assets.js';
import { SceneGraph } from '../src/scene-graph.js';
import { createMeshSystem } from '../src/systems/mesh-system.js';

/** Resolves loads only when we say so, to test the async seam deterministically. */
function controllableSource() {
  const resolvers: (() => void)[] = [];
  let calls = 0;
  return {
    get calls() { return calls; },
    flush: async () => {
      for (const r of resolvers.splice(0)) r();
      // AssetCache chains an internal `.catch` plus its own async `get()` before
      // our consumer ever sees the value, so a single microtask tick is not
      // enough to observe the attach. Deferring to a macrotask reliably drains
      // every pending microtask first.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    async load(_url: string) {
      calls++;
      await new Promise<void>((resolve) => resolvers.push(resolve));
      return new Mesh() as Object3D;
    },
  };
}

describe('mesh system', () => {
  let root: Object3D;
  let graph: SceneGraph;
  let world: World;
  let source: ReturnType<typeof controllableSource>;
  let system: ReturnType<typeof createMeshSystem>;

  beforeEach(() => {
    root = new Object3D();
    graph = new SceneGraph(root);
    world = new World();
    source = controllableSource();
    system = createMeshSystem(graph, new AssetCache(source));
  });

  it('requests the asset for a Mesh component', () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    expect(source.calls).toBe(1);
  });

  it('attaches the loaded object once it resolves', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();
    expect(graph.objectOf(e)).toBeInstanceOf(Mesh);
  });

  it('does not request the same asset twice for one entity', () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    system(world, 0.016);
    expect(source.calls).toBe(1);
  });

  it('ignores a Mesh with a null asset', () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: null, castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    expect(source.calls).toBe(0);
  });

  it('reloads when the asset path changes', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();
    world.set(e, MESH, { asset: 'b.glb', castShadow: true });
    system(world, 0.016);
    expect(source.calls).toBe(2);
  });

  it('applies castShadow to the loaded object and its descendants', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();
    expect(graph.objectOf(e)?.castShadow).toBe(true);
  });

  it('attaches nothing when the entity was despawned during the load', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    world.despawn(e);
    graph.sync(world);
    await source.flush();
    expect(graph.objectOf(e)).toBeUndefined();
  });

  it('keeps child entities attached when the asset replaces the placeholder', async () => {
    const parent = world.spawn('P');
    const child = world.spawn('C', parent);
    world.set(parent, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();
    graph.sync(world);
    expect(graph.objectOf(child)?.parent).toBe(graph.objectOf(parent));
  });
});
