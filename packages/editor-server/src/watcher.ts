import { relative } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { toPosix, type ProjectPaths } from './paths.js';
import type { AssetPipeline } from './assets/pipeline.js';
import type { ProjectEvent } from './types.js';

export interface WatcherOptions {
  paths: ProjectPaths;
  pipeline: AssetPipeline;
  emit: (event: ProjectEvent) => void;
}

export interface ProjectWatcher {
  close(): Promise<void>;
}

/**
 * Watches `assets/` and `scenes/`, re-optimizing on the way through.
 *
 * `.cache/` is deliberately not watched: the pipeline writes there, and a
 * watcher on its own output is a feedback loop waiting to happen.
 */
export async function createWatcher(options: WatcherOptions): Promise<ProjectWatcher> {
  const { paths, pipeline, emit } = options;
  let closed = false;

  const watcher: FSWatcher = chokidar.watch([paths.assets, paths.scenes], {
    ignoreInitial: true,
    // Blender writes a .glb in several passes; reacting to the first one would
    // hand a truncated file to gltf-transform.
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  });

  const assetPath = (file: string): string | null => {
    const rel = toPosix(relative(paths.assets, file));
    if (rel.startsWith('..') || rel.length === 0) return null;
    return rel.toLowerCase().endsWith('.glb') ? rel : null;
  };

  const scenePath = (file: string): string | null => {
    const rel = toPosix(relative(paths.scenes, file));
    if (rel.startsWith('..') || !rel.endsWith('.json') || rel.includes('/')) return null;
    return rel.slice(0, -'.json'.length);
  };

  const onUpsert = async (file: string): Promise<void> => {
    if (closed) return;
    const scene = scenePath(file);
    if (scene !== null) {
      emit({ type: 'scene-changed', name: scene });
      return;
    }
    const asset = assetPath(file);
    if (asset === null) return;
    try {
      const entry = await pipeline.importAsset(asset);
      if (!closed) emit({ type: 'asset-changed', path: asset, entry });
    } catch (cause) {
      // A failed re-optimization must not take the watcher down with it: the
      // artist fixes the export and saves again, and that save must be seen.
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!closed) emit({ type: 'asset-failed', path: asset, message });
    }
  };

  const onRemove = async (file: string): Promise<void> => {
    if (closed) return;
    const asset = assetPath(file);
    if (asset === null) return;
    await pipeline.removeAsset(asset).catch(() => undefined);
    if (!closed) emit({ type: 'asset-removed', path: asset });
  };

  watcher.on('add', (file) => void onUpsert(file));
  watcher.on('change', (file) => void onUpsert(file));
  watcher.on('unlink', (file) => void onRemove(file));

  await new Promise<void>((resolve) => { watcher.once('ready', () => resolve()); });

  return {
    async close(): Promise<void> {
      closed = true;
      await watcher.close();
    },
  };
}
