import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { ComponentRegistry } from '@nne/core';
import { build, type PlayerBundler } from './build.js';
import { HttpError, type ProjectStore } from './project-store.js';
import { createNotifier, type Notifier } from './notifier.js';
import type { AssetPipeline } from './assets/pipeline.js';
import type { ProjectPaths } from './paths.js';

export interface ServerOptions {
  paths: ProjectPaths;
  store: ProjectStore;
  pipeline: AssetPipeline;
  registry: ComponentRegistry;
  bundler?: PlayerBundler;
  /** Defaults to loopback. Overriding it exposes an unauthenticated API. */
  host?: string;
}

export interface EditorServer {
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
  address(): AddressInfo | null;
  readonly http: Server;
  readonly notifier: Notifier;
}

/** Wraps an async handler so a rejection reaches the error middleware. */
function route(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

/**
 * A route parameter as a plain string.
 *
 * Express types params as `string | string[] | undefined` — a repeated segment
 * arrives as an array. Anything that is not a single string becomes the empty
 * string, which every downstream allow-list rejects, so a malformed request
 * gets a 400 rather than a coerced path.
 */
function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return typeof value === 'string' ? value : '';
}

export function createServer(options: ServerOptions): EditorServer {
  const { paths, store, pipeline, registry, bundler } = options;
  const host = options.host ?? '127.0.0.1';
  const app = express();

  app.use(express.json({ limit: '32mb' }));
  app.use(express.raw({ type: 'image/png', limit: '4mb' }));

  app.get('/api/project', route(async (_req, res) => {
    res.json({ project: await store.readProject(), scenes: await store.listScenes() });
  }));

  app.get('/api/scenes/:name', route(async (req, res) => {
    res.json(await store.readScene(param(req, 'name')));
  }));

  app.put('/api/scenes/:name', route(async (req, res) => {
    await store.writeScene(param(req, 'name'), req.body);
    res.status(204).end();
  }));

  app.get('/api/assets', route(async (_req, res) => {
    res.json({ assets: await pipeline.entries() });
  }));

  app.post('/api/assets/scan', route(async (_req, res) => {
    const problems: { path: string; message: string }[] = [];
    const assets = await pipeline.scanAll((path, message) => problems.push({ path, message }));
    res.json({ assets, problems });
  }));

  app.put('/api/assets/thumbnail', route(async (req, res) => {
    const path = req.query['path'];
    if (typeof path !== 'string') throw new HttpError(400, 'missing "path" query parameter');
    res.json(await pipeline.setThumbnail(path, new Uint8Array(req.body as Buffer)));
  }));

  app.post('/api/build', route(async (req, res) => {
    const outDir = (req.body as { outDir?: unknown }).outDir;
    if (typeof outDir !== 'string') throw new HttpError(400, 'missing "outDir"');
    let result;
    try {
      result = await build({ paths, store, pipeline, registry, request: { outDir }, ...(bundler ? { bundler } : {}) });
    } catch (cause) {
      // The build's own refusals are client errors, not server faults.
      throw new HttpError(400, cause instanceof Error ? cause.message : String(cause), { cause });
    }
    res.json(result);
  }));

  // The runtime loads from the cache, never from the sources: only `.cache/` is
  // ever served, and express's static handler does the containment itself.
  app.use('/cache', express.static(paths.cache, { index: false, dotfiles: 'ignore' }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // A malformed JSON body surfaces from express's parser, not from our code.
    const status = error instanceof HttpError
      ? error.status
      : (error as { type?: string }).type === 'entity.parse.failed'
        ? 400
        : 500;
    const message = error instanceof Error ? error.message : String(error);
    if (status === 500) console.error('editor-server:', error);
    res.status(status).json({ error: message });
  });

  const http = createHttpServer(app);
  const notifier = createNotifier(http);

  return {
    http,
    notifier,
    address: () => http.address() as AddressInfo | null,
    listen(port = 5174): Promise<number> {
      return new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, host, () => {
          resolve((http.address() as AddressInfo).port);
        });
      });
    },
    async close(): Promise<void> {
      await notifier.close();
      await new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
