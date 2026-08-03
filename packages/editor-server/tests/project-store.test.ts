import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentRegistry, registerBuiltins, stringifyScene, type SceneFile } from '@nne/core';
import { resolveProject } from '../src/paths.js';
import { ProjectStore } from '../src/project-store.js';

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [
    {
      id: 1,
      name: 'Chair',
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Mesh: { asset: 'PRP_Chair_01.glb', castShadow: true },
      },
    },
  ],
};

describe('ProjectStore', () => {
  let dir: string;
  let store: ProjectStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-project-'));
    const registry = new ComponentRegistry();
    registerBuiltins(registry);
    store = new ProjectStore(resolveProject(dir), registry);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  describe('init', () => {
    it('creates the project layout', async () => {
      await store.init('demo');
      const project = await store.readProject();
      expect(project).toEqual({ name: 'demo', version: 1, startScene: null });
      expect(await store.listScenes()).toEqual([]);
    });

    it('does not overwrite an existing project', async () => {
      await store.init('demo');
      await store.writeProject({ name: 'demo', version: 1, startScene: 'Scene_01' });
      await store.init('other');
      expect((await store.readProject()).startScene).toBe('Scene_01');
    });
  });

  describe('readProject', () => {
    it('reports a missing project file as 404', async () => {
      await expect(store.readProject()).rejects.toMatchObject({ status: 404 });
    });

    it('rejects a project file with the wrong version', async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'project.json'), '{"name":"x","version":99,"startScene":null}');
      await expect(store.readProject()).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a project file that is not an object', async () => {
      await writeFile(join(dir, 'project.json'), '[]');
      await expect(store.readProject()).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a project file that is not JSON', async () => {
      await writeFile(join(dir, 'project.json'), 'not json');
      await expect(store.readProject()).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('listScenes', () => {
    it('returns an empty list when the folder does not exist', async () => {
      expect(await store.listScenes()).toEqual([]);
    });

    it('lists scene names without the extension, sorted', async () => {
      await mkdir(join(dir, 'scenes'), { recursive: true });
      for (const n of ['b', 'a', 'c']) await writeFile(join(dir, 'scenes', `${n}.json`), '{}');
      expect(await store.listScenes()).toEqual(['a', 'b', 'c']);
    });

    it('ignores files that are not .json and nested directories', async () => {
      await mkdir(join(dir, 'scenes', 'sub'), { recursive: true });
      await writeFile(join(dir, 'scenes', 'a.json'), '{}');
      await writeFile(join(dir, 'scenes', 'notes.txt'), 'x');
      expect(await store.listScenes()).toEqual(['a']);
    });

    it('ignores a file whose stem is not a valid scene name', async () => {
      await mkdir(join(dir, 'scenes'), { recursive: true });
      await writeFile(join(dir, 'scenes', 'a b.json'), '{}');
      await writeFile(join(dir, 'scenes', 'ok.json'), '{}');
      expect(await store.listScenes()).toEqual(['ok']);
    });
  });

  describe('readScene', () => {
    it('reads a scene back', async () => {
      await store.writeScene('Scene_01', scene);
      expect(await store.readScene('Scene_01')).toEqual(scene);
    });

    it('reports a missing scene as 404', async () => {
      await expect(store.readScene('Nope')).rejects.toMatchObject({ status: 404 });
    });

    it('refuses a traversal in the name', async () => {
      await expect(store.readScene('../../etc/passwd')).rejects.toMatchObject({ status: 400 });
    });

    it('refuses a name with a slash even if it would resolve inside', async () => {
      await expect(store.readScene('sub/Scene_01')).rejects.toMatchObject({ status: 400 });
    });

    it('reports a corrupt scene on disk as 400, not as a crash', async () => {
      await mkdir(join(dir, 'scenes'), { recursive: true });
      await writeFile(join(dir, 'scenes', 'Broken.json'), '{ nope');
      await expect(store.readScene('Broken')).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('writeScene', () => {
    it('writes a scene in the stable stringified form', async () => {
      await store.writeScene('Scene_01', scene);
      const onDisk = await readFile(join(dir, 'scenes', 'Scene_01.json'), 'utf8');
      expect(onDisk).toBe(stringifyScene(scene));
    });

    it('round-trips byte for byte', async () => {
      await store.writeScene('Scene_01', scene);
      const first = await readFile(join(dir, 'scenes', 'Scene_01.json'), 'utf8');
      await store.writeScene('Scene_01', await store.readScene('Scene_01'));
      expect(await readFile(join(dir, 'scenes', 'Scene_01.json'), 'utf8')).toBe(first);
    });

    it('refuses an invalid scene and writes nothing', async () => {
      const bad = { version: 1, name: 'x', entities: [{ id: 1, components: { Nope: {} } }] };
      await expect(store.writeScene('Scene_01', bad)).rejects.toMatchObject({ status: 400 });
      await expect(store.readScene('Scene_01')).rejects.toMatchObject({ status: 404 });
    });

    it('reports every validation error, not just the first', async () => {
      const bad = {
        version: 1,
        name: 'x',
        entities: [{ id: 1, components: { Nope: {} } }, { id: 2, components: { AlsoNope: {} } }],
      };
      await expect(store.writeScene('Scene_01', bad)).rejects.toThrow(/Nope[\s\S]*AlsoNope/);
    });

    it('refuses a traversal in the name and creates no file', async () => {
      await expect(store.writeScene('../evil', scene)).rejects.toMatchObject({ status: 400 });
    });

    it('does not corrupt an existing scene when the new one is invalid', async () => {
      await store.writeScene('Scene_01', scene);
      await expect(store.writeScene('Scene_01', { version: 1 })).rejects.toThrow();
      expect(await store.readScene('Scene_01')).toEqual(scene);
    });
  });
});
