import { beforeEach, describe, expect, it } from 'vitest';
import { Mesh, Object3D } from 'three';
import { MESH, World } from '@nne/core';
import { AssetCache } from '../src/assets.js';
import { SceneGraph } from '../src/scene-graph.js';
import { createMeshSystem } from '../src/systems/mesh-system.js';

/** Resolves loads only when we say so, to test the async seam deterministically. */
function controllableSource() {
  const resolvers: (() => void)[] = [];
  const rejecters: (() => void)[] = [];
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
    /** Rejects all pending loads instead of resolving them. */
    reject: async () => {
      for (const r of rejecters.splice(0)) r();
      resolvers.splice(0);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    async load(_url: string) {
      calls++;
      let rejectFn!: () => void;
      const rejectPromise = new Promise<void>((_resolve, reject) => {
        rejectFn = () => reject(new Error('load failed'));
      });
      rejecters.push(rejectFn);
      const resolvePromise = new Promise<void>((resolve) => resolvers.push(resolve));
      await Promise.race([resolvePromise, rejectPromise]);
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

  it('applies the current castShadow, not the stale one captured when the load started', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    // Same asset url, but castShadow changes while the load is still in flight.
    world.set(e, MESH, { asset: 'a.glb', castShadow: false });
    system(world, 0.016);
    await source.flush();
    expect(graph.objectOf(e)?.castShadow).toBe(false);
  });

  it('clears the resolved entry on load failure so a retry can happen', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.reject();

    // Same url as before: if `resolved` wasn't rolled back, this tick would
    // be silently ignored by the guard and no new load would be requested.
    system(world, 0.016);
    expect(source.calls).toBe(2);

    await source.flush();
    expect(graph.objectOf(e)).toBeInstanceOf(Mesh);
  });

  it('applies castShadow when it changes after the load has finished', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();

    // Same url, so the reload guard skips the entity — but the component is
    // still the source of truth and the object must follow it.
    world.set(e, MESH, { asset: 'a.glb', castShadow: false });
    system(world, 0.016);
    expect(graph.objectOf(e)?.castShadow).toBe(false);
    expect(source.calls).toBe(1);
  });

  it('drops the loaded object when the Mesh component is removed', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();
    expect(graph.objectOf(e)).toBeInstanceOf(Mesh);

    world.remove(e, MESH);
    system(world, 0.016);
    expect(graph.objectOf(e)).toBeUndefined();

    // The entity is still alive, so `sync` gives it a plain placeholder back.
    graph.sync(world);
    expect(graph.objectOf(e)).toBeInstanceOf(Object3D);
    expect(graph.objectOf(e)).not.toBeInstanceOf(Mesh);
  });

  it('drops the loaded object when the asset goes back to null', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();

    world.set(e, MESH, { asset: null, castShadow: true });
    system(world, 0.016);
    expect(graph.objectOf(e)).toBeUndefined();
  });

  it('reloads the asset when a removed Mesh component comes back', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();

    world.remove(e, MESH);
    system(world, 0.016);
    graph.sync(world);

    // Same url as before: without clearing the resolved entry, the guard would
    // swallow this tick and the entity would stay meshless forever. The load
    // itself is served from the AssetCache, so the source is not hit again.
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    system(world, 0.016);
    await source.flush();
    expect(graph.objectOf(e)).toBeInstanceOf(Mesh);
    expect(source.calls).toBe(1);
  });

  it('leaves an object another system owns alone when the Mesh component goes', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();

    // Something else — the camera or light system — took the entity over.
    const owned = new Object3D();
    graph.attach(e, owned);

    world.remove(e, MESH);
    system(world, 0.016);
    expect(graph.objectOf(e)).toBe(owned);
  });

  it('attaches nothing when the component is removed mid-load', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);

    world.remove(e, MESH);
    system(world, 0.016);
    await source.flush();

    graph.sync(world);
    expect(graph.objectOf(e)).not.toBeInstanceOf(Mesh);
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
