import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentRegistry, registerBuiltins, type SceneFile } from '@nne/core';
import { resolveProject } from '../src/paths.js';
import { ProjectStore } from '../src/project-store.js';
import { AssetPipeline } from '../src/assets/pipeline.js';
import { createServer, type EditorServer } from '../src/server.js';
import type { AssetOptimizer } from '../src/assets/optimizer.js';

const optimizer: AssetOptimizer = {
  async run({ target }) {
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, 'optimized');
    return { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, animations: [], triangles: 3 };
  },
};

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [{
    id: 1,
    name: 'Chair',
    components: { Mesh: { asset: 'props/PRP_Chair_01.glb', castShadow: true } },
  }],
};

function registry(): ComponentRegistry {
  const r = new ComponentRegistry();
  registerBuiltins(r);
  return r;
}

describe('editor server', () => {
  let dir: string;
  let server: EditorServer;
  let base: string;
  let store: ProjectStore;
  let pipeline: AssetPipeline;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-server-'));
    const paths = resolveProject(dir);
    store = new ProjectStore(paths, registry());
    pipeline = new AssetPipeline(paths, optimizer);
    await store.init('demo');

    server = createServer({ paths, store, pipeline, registry: registry() });
    base = `http://127.0.0.1:${await server.listen(0)}`;
  });
  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function addAsset(): Promise<void> {
    await mkdir(join(dir, 'assets', 'props'), { recursive: true });
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
    await pipeline.scanAll();
  }

  describe('GET /api/project', () => {
    it('returns the manifest and the scene list', async () => {
      await store.writeScene('Scene_01', scene);
      const response = await fetch(`${base}/api/project`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        project: { name: 'demo', version: 1 },
        scenes: ['Scene_01'],
      });
    });
  });

  describe('GET /api/scenes/:name', () => {
    it('returns a scene', async () => {
      await store.writeScene('Scene_01', scene);
      const response = await fetch(`${base}/api/scenes/Scene_01`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(scene);
    });

    it('answers 404 for a missing scene', async () => {
      expect((await fetch(`${base}/api/scenes/Nope`)).status).toBe(404);
    });

    it('answers 400 for a name that is not allow-listed', async () => {
      expect((await fetch(`${base}/api/scenes/not%20ok`)).status).toBe(400);
    });

    it('does not serve a file outside the project', async () => {
      const response = await fetch(`${base}/api/scenes/..%2F..%2Fetc%2Fpasswd`);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('PUT /api/scenes/:name', () => {
    it('saves a scene', async () => {
      const response = await fetch(`${base}/api/scenes/Scene_01`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(scene),
      });
      expect(response.status).toBe(204);
      expect(await store.readScene('Scene_01')).toEqual(scene);
    });

    it('answers 400 for an invalid scene and writes nothing', async () => {
      const response = await fetch(`${base}/api/scenes/Scene_01`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 1, name: 'x', entities: [{ id: 1, components: { Nope: {} } }],
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('Nope') });
      await expect(store.readScene('Scene_01')).rejects.toMatchObject({ status: 404 });
    });

    it('answers 400 for a body that is not JSON', async () => {
      const response = await fetch(`${base}/api/scenes/Scene_01`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/assets', () => {
    it('lists the cached assets with their metadata', async () => {
      await addAsset();
      const response = await fetch(`${base}/api/assets`);
      expect(await response.json()).toMatchObject({
        assets: [{ path: 'props/PRP_Chair_01.glb', category: 'PRP', metadata: { triangles: 3 } }],
      });
    });

    it('returns an empty list on a fresh project', async () => {
      expect(await (await fetch(`${base}/api/assets`)).json()).toEqual({ assets: [] });
    });
  });

  describe('POST /api/assets/scan', () => {
    it('reports assets and the problems it found', async () => {
      await mkdir(join(dir, 'assets', 'props'), { recursive: true });
      await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
      await writeFile(join(dir, 'assets', 'props', 'Chair.glb'), 'x');

      const body = await (await fetch(`${base}/api/assets/scan`, { method: 'POST' })).json();
      expect(body).toMatchObject({
        assets: [{ path: 'props/PRP_Chair_01.glb' }],
        problems: [{ path: 'props/Chair.glb' }],
      });
    });
  });

  describe('PUT /api/assets/thumbnail', () => {
    it('stores a thumbnail for a known asset', async () => {
      await addAsset();
      const response = await fetch(
        `${base}/api/assets/thumbnail?path=props/PRP_Chair_01.glb`,
        {
          method: 'PUT',
          headers: { 'content-type': 'image/png' },
          body: new Uint8Array([137, 80, 78, 71]),
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json())
        .toMatchObject({ thumbnail: 'thumbnails/props/PRP_Chair_01.png' });
    });

    it('answers 400 without a path', async () => {
      const response = await fetch(`${base}/api/assets/thumbnail`, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array([1]),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('cache files', () => {
    it('serves an optimized asset', async () => {
      await addAsset();
      const response = await fetch(`${base}/cache/assets/props/PRP_Chair_01.glb`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('optimized');
    });

    it('does not serve a file outside the cache', async () => {
      const response = await fetch(`${base}/cache/..%2F..%2Fproject.json`);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /api/build', () => {
    it('builds into the requested folder', async () => {
      await store.writeScene('Scene_01', { ...scene, entities: [] });
      const response = await fetch(`${base}/api/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outDir: join(dir, 'dist') }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ scenes: ['Scene_01'] });
    });

    it('answers 400 when the build refuses the target', async () => {
      const response = await fetch(`${base}/api/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outDir: dir }),
      });
      expect(response.status).toBe(400);
    });

    it('answers 400 without an outDir', async () => {
      const response = await fetch(`${base}/api/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('binding', () => {
    it('listens on loopback only by default', async () => {
      const paths = resolveProject(dir);
      const local = createServer({ paths, store, pipeline, registry: registry() });
      const port = await local.listen(0);
      expect(local.address()?.address).toBe('127.0.0.1');
      expect(port).toBeGreaterThan(0);
      await local.close();
    });
  });

  describe('unknown routes', () => {
    it('answers 404 with a JSON body, not an HTML page', async () => {
      const response = await fetch(`${base}/api/nope`);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
    });
  });
});
