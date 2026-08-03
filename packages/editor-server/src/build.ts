import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ComponentRegistry, SceneFile } from '@nne/core';
import { writeAtomic } from './atomic.js';
import { containedJoin, type ProjectPaths } from './paths.js';
import type { AssetPipeline } from './assets/pipeline.js';
import type { ProjectStore } from './project-store.js';

/** Compiles the player. Injectable so a build test never has to run Vite. */
export interface PlayerBundler {
  bundle(outDir: string): Promise<void>;
}

export interface BuildRequest {
  outDir: string;
}

export interface BuildOptions {
  paths: ProjectPaths;
  store: ProjectStore;
  pipeline: AssetPipeline;
  registry: ComponentRegistry;
  request: BuildRequest;
  bundler?: PlayerBundler;
}

export interface BuildResult {
  outDir: string;
  scenes: string[];
  assets: string[];
}

/**
 * Every asset path any scene refers to, deduplicated and sorted.
 *
 * Driven by the registry rather than by a hard-coded knowledge of `Mesh.asset`:
 * a project that defines its own component with an `asset` field gets its files
 * shipped without a line changing here. That is what the schema registry is for.
 */
export function referencedAssets(scenes: SceneFile[], registry: ComponentRegistry): string[] {
  const assetFields = new Map<string, string[]>();
  for (const type of registry.list()) {
    const schema = registry.get(type);
    if (!schema) continue;
    const fields = Object.entries(schema)
      .filter(([, spec]) => spec.type === 'asset')
      .map(([field]) => field);
    if (fields.length > 0) assetFields.set(type, fields);
  }

  const found = new Set<string>();
  for (const scene of scenes) {
    for (const entity of scene.entities) {
      for (const [type, data] of Object.entries(entity.components)) {
        // Scenes are read straight off disk here, without revalidation: a
        // project folder is hand-edited and merged by git, so a component that
        // is null or a bare string has to yield nothing rather than throw.
        if (typeof data !== 'object' || data === null) continue;
        for (const field of assetFields.get(type) ?? []) {
          const value = (data as Record<string, unknown>)[field];
          // null is the normal "no asset yet" value; anything non-string is a
          // scene that lied, and validation is not this function's job.
          if (typeof value === 'string' && value.length > 0) found.add(value);
        }
      }
    }
  }
  return [...found].sort();
}

/**
 * Produces a self-contained static folder: the compiled player, the scenes, and
 * only the assets those scenes actually reach. Nothing of the editor ships.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const { paths, store, pipeline, registry, request, bundler } = options;
  const outDir = resolve(request.outDir);

  // The build empties its target, so pointing it at the project root — or at
  // any folder the project keeps its data in — would delete the sources.
  // Refused outright rather than made clever. A subfolder such as <root>/dist
  // stays allowed: it is the normal case.
  if (outDir === paths.root) {
    throw new Error(`refus de builder dans la racine du projet: ${outDir}`);
  }
  for (const reserved of [paths.assets, paths.scenes, paths.cache]) {
    if (outDir === reserved) {
      throw new Error(`refus de builder dans un dossier du projet: ${outDir}`);
    }
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  if (bundler) await bundler.bundle(outDir);

  const project = await store.readProject();
  const names = await store.listScenes();
  const scenes: SceneFile[] = [];
  for (const name of names) {
    const scene = await store.readScene(name);
    scenes.push(scene);
    await writeAtomic(join(outDir, 'scenes', `${name}.json`), JSON.stringify(scene));
  }

  const assets = referencedAssets(scenes, registry);
  for (const asset of assets) {
    const entry = await pipeline.entry(asset);
    if (!entry) {
      throw new Error(`scene references "${asset}", which is not in the asset cache`);
    }
    const from = containedJoin(paths.cache, entry.cached);
    try {
      await stat(from);
    } catch {
      throw new Error(`cached file for "${asset}" is missing; run a scan before building`);
    }
    const to = containedJoin(outDir, join('assets', asset));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }

  await writeAtomic(
    join(outDir, 'project.json'),
    `${JSON.stringify({ name: project.name, startScene: project.startScene, scenes: names }, null, 2)}\n`,
  );

  return { outDir, scenes: names, assets };
}
