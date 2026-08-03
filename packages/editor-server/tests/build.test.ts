import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentRegistry, registerBuiltins, type SceneFile } from '@nne/core';
import { resolveProject } from '../src/paths.js';
import { ProjectStore } from '../src/project-store.js';
import { AssetPipeline } from '../src/assets/pipeline.js';
import { build, referencedAssets } from '../src/build.js';
import type { AssetOptimizer } from '../src/assets/optimizer.js';

function registry(): ComponentRegistry {
  const r = new ComponentRegistry();
  registerBuiltins(r);
  return r;
}

function sceneWith(assets: (string | null)[], name = 'Scene_01'): SceneFile {
  return {
    version: 1,
    name,
    entities: assets.map((asset, i) => ({
      id: i + 1,
      name: `E${i}`,
      components: { Mesh: { asset, castShadow: true } },
    })),
  };
}

describe('referencedAssets', () => {
  it('collects the asset of every Mesh', () => {
    expect(referencedAssets([sceneWith(['a.glb', 'b.glb'])], registry()))
      .toEqual(['a.glb', 'b.glb']);
  });

  it('deduplicates across entities and scenes', () => {
    const scenes = [sceneWith(['a.glb', 'a.glb']), sceneWith(['a.glb'])];
    expect(referencedAssets(scenes, registry())).toEqual(['a.glb']);
  });

  it('ignores null assets', () => {
    expect(referencedAssets([sceneWith(['a.glb', null])], registry())).toEqual(['a.glb']);
  });

  it('finds asset fields on any component, not just Mesh', () => {
    const r = registry();
    r.define('Decal', { texture: { type: 'asset', default: null, accept: '.glb' } });
    const scene: SceneFile = {
      version: 1,
      name: 'S',
      entities: [{ id: 1, name: 'D', components: { Decal: { texture: 'd.glb' } } }],
    };
    expect(referencedAssets([scene], r)).toEqual(['d.glb']);
  });

  it('ignores components the registry does not know', () => {
    const scene: SceneFile = {
      version: 1,
      name: 'S',
      entities: [{ id: 1, name: 'X', components: { Unknown: { asset: 'x.glb' } } }],
    };
    expect(referencedAssets([scene], registry())).toEqual([]);
  });

  it('ignores a non-string value in an asset field', () => {
    const scene: SceneFile = {
      version: 1,
      name: 'S',
      entities: [{ id: 1, name: 'X', components: { Mesh: { asset: 42, castShadow: true } } }],
    };
    expect(referencedAssets([scene], registry())).toEqual([]);
  });

  it('ignores a non-asset field that happens to hold a path-like string', () => {
    // `Light.color` is a color, not an asset: only the schema decides.
    const scene: SceneFile = {
      version: 1,
      name: 'S',
      entities: [{
        id: 1,
        name: 'X',
        components: { Light: { type: 'point', color: '#ffffff', intensity: 1 } },
      }],
    };
    expect(referencedAssets([scene], registry())).toEqual([]);
  });

  it('survives a hand-edited scene whose component data is not an object', () => {
    // `build` reads scenes straight off disk without revalidating them, and a
    // project folder is edited by hand and by git merges. A null component
    // must yield no asset, not a TypeError that takes the build down.
    const scene = {
      version: 1,
      name: 'S',
      entities: [
        { id: 1, name: 'X', components: { Mesh: null } },
        { id: 2, name: 'Y', components: { Mesh: 'not an object' } },
        { id: 3, name: 'Z', components: { Mesh: { asset: 'ok.glb', castShadow: true } } },
      ],
    } as unknown as SceneFile;
    expect(referencedAssets([scene], registry())).toEqual(['ok.glb']);
  });

  it('returns a sorted list, so a build is reproducible', () => {
    expect(referencedAssets([sceneWith(['b.glb', 'a.glb'])], registry()))
      .toEqual(['a.glb', 'b.glb']);
  });
});

describe('build', () => {
  let dir: string;
  let out: string;
  let store: ProjectStore;
  let pipeline: AssetPipeline;

  const optimizer: AssetOptimizer = {
    async run({ target }) {
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, 'optimized');
      return { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, animations: [], triangles: 1 };
    },
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-build-'));
    out = join(dir, 'dist');
    const paths = resolveProject(dir);
    store = new ProjectStore(paths, registry());
    pipeline = new AssetPipeline(paths, optimizer);
    await store.init('demo');
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function options(overrides: Partial<Parameters<typeof build>[0]> = {}) {
    return {
      paths: resolveProject(dir),
      store,
      pipeline,
      registry: registry(),
      request: { outDir: out },
      ...overrides,
    };
  }

  async function addAsset(rel: string): Promise<void> {
    const file = join(dir, 'assets', rel);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'source');
    await pipeline.importAsset(rel);
  }

  it('copies the scenes and only the referenced assets', async () => {
    await addAsset('props/PRP_Used.glb');
    await addAsset('props/PRP_Unused.glb');
    await store.writeScene('Scene_01', sceneWith(['props/PRP_Used.glb']));

    const result = await build(options());

    expect(result.assets).toEqual(['props/PRP_Used.glb']);
    expect(await readFile(join(out, 'scenes', 'Scene_01.json'), 'utf8')).toContain('PRP_Used');
    expect(await readFile(join(out, 'assets', 'props', 'PRP_Used.glb'), 'utf8')).toBe('optimized');
    await expect(readFile(join(out, 'assets', 'props', 'PRP_Unused.glb'))).rejects.toThrow();
  });

  it('copies from the cache, never from the sources', async () => {
    await addAsset('props/PRP_Used.glb');
    await store.writeScene('Scene_01', sceneWith(['props/PRP_Used.glb']));
    await build(options());
    // "source" is what the raw file says; "optimized" is what the cache says.
    expect(await readFile(join(out, 'assets', 'props', 'PRP_Used.glb'), 'utf8')).toBe('optimized');
  });

  it('writes a manifest listing the scenes and the start scene', async () => {
    await store.writeProject({ name: 'demo', version: 1, startScene: 'Scene_01' });
    await store.writeScene('Scene_01', sceneWith([]));
    await build(options());
    const manifest = JSON.parse(await readFile(join(out, 'project.json'), 'utf8')) as unknown;
    expect(manifest).toMatchObject({ name: 'demo', startScene: 'Scene_01', scenes: ['Scene_01'] });
  });

  it('fails when a scene references an asset that is not in the cache', async () => {
    await store.writeScene('Scene_01', sceneWith(['props/PRP_Ghost.glb']));
    await expect(build(options())).rejects.toThrow(/PRP_Ghost/);
  });

  it('empties a previous build instead of merging into it', async () => {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'stale.txt'), 'old');
    await store.writeScene('Scene_01', sceneWith([]));
    await build(options());
    await expect(readFile(join(out, 'stale.txt'))).rejects.toThrow();
  });

  it('refuses to build into the project root', async () => {
    await expect(build(options({ request: { outDir: dir } }))).rejects.toThrow(/refus/i);
  });

  it('refuses to build into a project folder it would delete', async () => {
    for (const target of ['assets', 'scenes', '.cache']) {
      await expect(build(options({ request: { outDir: join(dir, target) } })))
        .rejects.toThrow(/refus/i);
    }
  });

  it('runs the bundler and copies its output', async () => {
    await store.writeScene('Scene_01', sceneWith([]));
    const bundler = {
      async bundle(target: string): Promise<void> {
        await mkdir(target, { recursive: true });
        await writeFile(join(target, 'index.html'), '<html></html>');
      },
    };
    await build(options({ bundler }));
    expect(await readFile(join(out, 'index.html'), 'utf8')).toBe('<html></html>');
  });

  it('builds without a bundler, for a data-only export', async () => {
    await store.writeScene('Scene_01', sceneWith([]));
    expect((await build(options())).scenes).toEqual(['Scene_01']);
  });

  it('exports every scene in the project, not just the start one', async () => {
    await store.writeScene('Scene_01', sceneWith([]));
    await store.writeScene('Scene_02', sceneWith([], 'Scene_02'));
    expect((await build(options())).scenes).toEqual(['Scene_01', 'Scene_02']);
  });
});
