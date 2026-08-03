import { describe, expect, it, vi } from 'vitest';
import { Mesh, Object3D } from 'three';
import { MESH, World } from '@nne/core';
import { AssetCache, SceneGraph, createMeshSystem, resolveAssetUrl } from '@nne/runtime';
import { assetUrl } from '../src/api/client.js';

describe('asset loading in the editor', () => {
  it('resolves a component path to the url the server actually serves', () => {
    // A Mesh component stores "props/PRP_Chair_01.glb"; editor-server serves the
    // optimized file at /cache/assets/props/PRP_Chair_01.glb. Loading the raw
    // path would 404 for every mesh in every scene.
    expect(resolveAssetUrl('/cache/assets', 'props/PRP_Chair_01.glb'))
      .toBe(assetUrl('props/PRP_Chair_01.glb'));
  });

  it('reaches the cache url end to end, from component to loader', async () => {
    const requested: string[] = [];
    // The same wiring the controller builds, with the network faked out.
    const source = {
      async load(path: string) {
        requested.push(resolveAssetUrl('/cache/assets', path));
        return new Mesh() as Object3D;
      },
    };
    const world = new World();
    const entity = world.spawn('Chair');
    world.set(entity, MESH, { asset: 'props/PRP_Chair_01.glb', castShadow: true });

    const graph = new SceneGraph(new Object3D());
    graph.sync(world);
    createMeshSystem(graph, new AssetCache(source))(world, 0.016);
    await vi.waitFor(() => expect(requested).toHaveLength(1));

    expect(requested[0]).toBe('/cache/assets/props/PRP_Chair_01.glb');
  });
});
