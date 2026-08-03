import { describe, expect, it, vi } from 'vitest';
import { Mesh, Object3D } from 'three';
import { AssetCache, resolveAssetUrl, type GltfSource } from '../src/assets.js';

function sourceOf(make: () => Object3D = () => new Mesh()): GltfSource & { calls: number } {
  const source = {
    calls: 0,
    async load(_url: string) { source.calls++; return make(); },
  };
  return source;
}

describe('AssetCache', () => {
  it('loads an asset', async () => {
    const cache = new AssetCache(sourceOf());
    expect(await cache.get('a.glb')).toBeInstanceOf(Object3D);
  });

  it('loads each url only once', async () => {
    const source = sourceOf();
    const cache = new AssetCache(source);
    await cache.get('a.glb');
    await cache.get('a.glb');
    expect(source.calls).toBe(1);
  });

  it('does not double-load on concurrent requests for the same url', async () => {
    const source = sourceOf();
    const cache = new AssetCache(source);
    await Promise.all([cache.get('a.glb'), cache.get('a.glb'), cache.get('a.glb')]);
    expect(source.calls).toBe(1);
  });

  it('returns a distinct clone per call', async () => {
    const cache = new AssetCache(sourceOf());
    const first = await cache.get('a.glb');
    const second = await cache.get('a.glb');
    expect(first).not.toBe(second);
  });

  it('clones deeply so children are not shared', async () => {
    const cache = new AssetCache(sourceOf(() => {
      const root = new Object3D();
      root.add(new Mesh());
      return root;
    }));
    const first = await cache.get('a.glb');
    const second = await cache.get('a.glb');
    expect(first.children[0]).not.toBe(second.children[0]);
  });

  it('reports how many urls are cached', async () => {
    const cache = new AssetCache(sourceOf());
    await cache.get('a.glb');
    await cache.get('b.glb');
    expect(cache.size()).toBe(2);
  });

  it('clears the cache', async () => {
    const source = sourceOf();
    const cache = new AssetCache(source);
    await cache.get('a.glb');
    cache.clear();
    await cache.get('a.glb');
    expect(source.calls).toBe(2);
    expect(cache.size()).toBe(1);
  });

  it('does not cache a failed load, so a retry can succeed', async () => {
    let attempt = 0;
    const cache = new AssetCache({
      async load(_url: string) {
        attempt++;
        if (attempt === 1) throw new Error('network');
        return new Mesh();
      },
    });
    await expect(cache.get('a.glb')).rejects.toThrow('network');
    expect(await cache.get('a.glb')).toBeInstanceOf(Object3D);
  });

  it('names the failing url when a load rejects', async () => {
    const cache = new AssetCache({ async load() { throw new Error('404'); } });
    await expect(cache.get('missing.glb')).rejects.toThrow(/missing\.glb/);
  });
});

describe('resolveAssetUrl', () => {
  it('returns the path unchanged with no base', () => {
    expect(resolveAssetUrl('', 'props/PRP_Chair_01.glb')).toBe('props/PRP_Chair_01.glb');
  });

  it('roots a component path under the editor cache', () => {
    // The editor serves optimized assets here; without a base the loader would
    // request the path verbatim and get a 404 for every mesh in the scene.
    expect(resolveAssetUrl('/cache/assets', 'props/PRP_Chair_01.glb'))
      .toBe('/cache/assets/props/PRP_Chair_01.glb');
  });

  it('roots a component path under a build output', () => {
    expect(resolveAssetUrl('assets', 'props/PRP_Chair_01.glb'))
      .toBe('assets/props/PRP_Chair_01.glb');
  });

  it('does not double up separators', () => {
    expect(resolveAssetUrl('/cache/assets/', '/props/A.glb')).toBe('/cache/assets/props/A.glb');
  });

  it('handles a base with several trailing slashes', () => {
    expect(resolveAssetUrl('/cache//', 'A.glb')).toBe('/cache/A.glb');
  });
});
