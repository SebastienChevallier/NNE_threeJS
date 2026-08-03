import { basename } from 'node:path';
import { ComponentRegistry, registerBuiltins } from '@nne/core';
import { createGltfTransformOptimizer } from './assets/optimizer.js';
import { AssetPipeline } from './assets/pipeline.js';
import { resolveProject } from './paths.js';
import { ProjectStore } from './project-store.js';
import { createServer } from './server.js';
import { createWatcher, type ProjectWatcher } from './watcher.js';
import type { PlayerBundler } from './build.js';

export interface StartOptions {
  root: string;
  port?: number;
  host?: string;
  bundler?: PlayerBundler;
  /** Set false to serve without watching, e.g. for a one-shot build server. */
  watch?: boolean;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/** Boots the whole editor server: scan, serve, watch. What `pnpm editor` calls. */
export async function startEditorServer(options: StartOptions): Promise<RunningServer> {
  const paths = resolveProject(options.root);
  const registry = new ComponentRegistry();
  registerBuiltins(registry);

  const store = new ProjectStore(paths, registry);
  await store.init(basename(paths.root) || 'project');

  const pipeline = new AssetPipeline(paths, await createGltfTransformOptimizer());
  // One pass before serving, so the editor never sees a half-populated cache.
  await pipeline.scanAll((path, message) => console.warn(`asset "${path}": ${message}`));

  const server = createServer({
    paths,
    store,
    pipeline,
    registry,
    ...(options.bundler ? { bundler: options.bundler } : {}),
    ...(options.host ? { host: options.host } : {}),
  });
  const port = await server.listen(options.port);

  let watcher: ProjectWatcher | undefined;
  if (options.watch !== false) {
    try {
      watcher = await createWatcher({
        paths,
        pipeline,
        emit: (event) => server.notifier.broadcast(event),
      });
    } catch (cause) {
      // A watcher that will not start must not leave the port bound.
      await server.close();
      throw cause;
    }
  }

  return {
    port,
    async close(): Promise<void> {
      await watcher?.close();
      await server.close();
    },
  };
}
