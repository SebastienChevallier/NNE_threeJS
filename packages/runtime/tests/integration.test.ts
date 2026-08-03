import { describe, expect, it } from 'vitest';
import { Mesh, type Object3D, PerspectiveCamera } from 'three';
import { ComponentRegistry, registerBuiltins } from '@nne/core';
import { AssetCache } from '../src/assets.js';
import { Engine } from '../src/engine.js';
import { loadSceneIntoWorld } from '../src/player.js';

const sceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [
    {
      id: 1, name: 'Camera',
      components: {
        Camera: { fov: 60, near: 0.1, far: 1000, active: true },
        Transform: { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
    {
      id: 2, name: 'Sun',
      components: { Light: { type: 'directional', color: '#ffffff', intensity: 1 } },
    },
    {
      id: 3, name: 'Chair', parent: 1,
      components: {
        Mesh: { asset: 'PRP_Chair_01.glb', castShadow: true },
        Transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
  ],
};

describe('scene file to rendered graph', () => {
  it('loads a scene and builds the matching three graph', async () => {
    const registry = new ComponentRegistry();
    registerBuiltins(registry);

    const world = loadSceneIntoWorld(sceneFile, registry);
    const engine = new Engine({
      world,
      assets: new AssetCache({ async load() { return new Mesh() as Object3D; } }),
    });

    engine.step(0.016);
    // A single microtask tick is not enough: AssetCache.get chains several
    // await/.catch hops before the mesh system's .then runs. Flush a macrotask.
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    engine.step(0.016);

    // The camera component produced a real camera, and it is active.
    expect(engine.activeCamera()).toBeInstanceOf(PerspectiveCamera);
    expect(engine.activeCamera()?.fov).toBe(60);

    // Transforms reached the graph.
    expect(engine.graph.objectOf(1)?.position.toArray()).toEqual([0, 1.6, 5]);
    expect(engine.graph.objectOf(3)?.position.toArray()).toEqual([1, 0, 0]);

    // The hierarchy from the scene file is mirrored.
    expect(engine.graph.objectOf(3)?.parent).toBe(engine.graph.objectOf(1));

    // The mesh asset was loaded and swapped in.
    expect(engine.graph.objectOf(3)).toBeInstanceOf(Mesh);
  });

  it('keeps the world as the source of truth after a component change', () => {
    const registry = new ComponentRegistry();
    registerBuiltins(registry);
    const world = loadSceneIntoWorld(sceneFile, registry);
    const engine = new Engine({ world, assets: new AssetCache({ async load() { return new Mesh() as Object3D; } }) });

    engine.step(0.016);
    world.set(1, 'Transform', { position: [7, 7, 7], rotation: [0, 0, 0], scale: [1, 1, 1] });
    engine.step(0.016);

    expect(engine.graph.objectOf(1)?.position.toArray()).toEqual([7, 7, 7]);
  });
});
