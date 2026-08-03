import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { ComponentRegistry, registerBuiltins, type SceneFile } from '@nne/core';
import { resolveProject } from '../src/paths.js';
import { ProjectStore } from '../src/project-store.js';
import { AssetPipeline } from '../src/assets/pipeline.js';
import { createServer, type EditorServer } from '../src/server.js';
import { createWatcher, type ProjectWatcher } from '../src/watcher.js';
import type { AssetOptimizer } from '../src/assets/optimizer.js';
import type { ProjectEvent } from '../src/types.js';

/** Stands in for gltf-transform: the real thing is covered in optimizer.test.ts. */
const optimizer: AssetOptimizer = {
  async run({ source, target }) {
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, `optimized:${await readFile(source, 'utf8')}`);
    return { bounds: { min: [0, 0, 0], max: [1, 2, 1] }, animations: ['Idle'], triangles: 42 };
  },
};

function sceneUsing(asset: string): SceneFile {
  return {
    version: 1,
    name: 'Scene_01',
    entities: [
      {
        id: 1,
        name: 'Chair',
        components: {
          Transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          Mesh: { asset, castShadow: true },
        },
      },
    ],
  };
}

describe('project folder to built output', () => {
  let dir: string;
  let server: EditorServer;
  let watcher: ProjectWatcher;
  let base: string;
  let events: ProjectEvent[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-e2e-'));
    await mkdir(join(dir, 'assets', 'props'), { recursive: true });
    await mkdir(join(dir, 'scenes'), { recursive: true });

    const paths = resolveProject(dir);
    const registry = new ComponentRegistry();
    registerBuiltins(registry);
    const store = new ProjectStore(paths, registry);
    const pipeline = new AssetPipeline(paths, optimizer);
    await store.init('demo');

    server = createServer({ paths, store, pipeline, registry });
    base = `http://127.0.0.1:${await server.listen(0)}`;

    events = [];
    watcher = await createWatcher({
      paths,
      pipeline,
      emit: (event) => {
        events.push(event);
        server.notifier.broadcast(event);
      },
    });
  });

  afterEach(async () => {
    await watcher.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('goes from an empty folder to a static build over the API', async () => {
    // A client is watching for disk changes, like the editor would be.
    const socket = new WebSocket(`${base.replace('http', 'ws')}/api/watch`);
    const pushed: ProjectEvent[] = [];
    socket.on('message', (data) => pushed.push(JSON.parse(String(data)) as ProjectEvent));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    // 1. The artist drops two .glb files into assets/.
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'chair');
    await writeFile(join(dir, 'assets', 'props', 'PRP_Unused.glb'), 'unused');

    // 2. The watcher optimizes them and pushes the news to the editor.
    await vi.waitFor(
      () => expect(pushed.filter((e) => e.type === 'asset-changed')).toHaveLength(2),
      { timeout: 15_000, interval: 50 },
    );
    expect(pushed[0]).toMatchObject({ entry: { metadata: { triangles: 42 } } });

    // 3. The optimized file is what the API serves, not the source.
    const served = await fetch(`${base}/cache/assets/props/PRP_Chair_01.glb`);
    expect(await served.text()).toBe('optimized:chair');

    // 4. The asset list carries the metadata the editor needs.
    const listed = await (await fetch(`${base}/api/assets`)).json() as {
      assets: { path: string }[];
    };
    expect(listed.assets.map((a) => a.path))
      .toEqual(['props/PRP_Chair_01.glb', 'props/PRP_Unused.glb']);

    // 5. The editor saves a scene that uses only one of the two assets.
    const put = await fetch(`${base}/api/scenes/Scene_01`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sceneUsing('props/PRP_Chair_01.glb')),
    });
    expect(put.status).toBe(204);

    // 6. The scene reads back identical through the API.
    const read = await (await fetch(`${base}/api/scenes/Scene_01`)).json();
    expect(read).toEqual(sceneUsing('props/PRP_Chair_01.glb'));

    // 7. Build.
    const out = join(dir, 'dist');
    const built = await (await fetch(`${base}/api/build`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outDir: out }),
    })).json() as { scenes: string[]; assets: string[] };

    expect(built.scenes).toEqual(['Scene_01']);
    expect(built.assets).toEqual(['props/PRP_Chair_01.glb']);

    // 8. The output is self-contained, optimized, and carries no dead weight.
    expect(await readFile(join(out, 'assets', 'props', 'PRP_Chair_01.glb'), 'utf8'))
      .toBe('optimized:chair');
    await expect(readFile(join(out, 'assets', 'props', 'PRP_Unused.glb'))).rejects.toThrow();
    expect(JSON.parse(await readFile(join(out, 'project.json'), 'utf8')))
      .toMatchObject({ name: 'demo', scenes: ['Scene_01'] });

    socket.close();
  });

  it('refuses to save an invalid scene and leaves the disk untouched', async () => {
    const response = await fetch(`${base}/api/scenes/Scene_01`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, name: 'x', entities: [{ id: 1, components: { Ghost: {} } }] }),
    });
    expect(response.status).toBe(400);
    expect((await fetch(`${base}/api/scenes/Scene_01`)).status).toBe(404);
  });

  it('drops an asset from the cache when its source is deleted', async () => {
    const file = join(dir, 'assets', 'props', 'PRP_Chair_01.glb');
    await writeFile(file, 'chair');
    await vi.waitFor(
      () => expect(events.some((e) => e.type === 'asset-changed')).toBe(true),
      { timeout: 15_000, interval: 50 },
    );

    await rm(file);
    await vi.waitFor(
      () => expect(events.some((e) => e.type === 'asset-removed')).toBe(true),
      { timeout: 15_000, interval: 50 },
    );

    const listed = await (await fetch(`${base}/api/assets`)).json() as { assets: unknown[] };
    expect(listed.assets).toEqual([]);
    expect((await fetch(`${base}/cache/assets/props/PRP_Chair_01.glb`)).status).toBe(404);
  });
});
