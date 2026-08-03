import {
  ComponentRegistry, type SceneFile, type World,
  deserializeScene, registerBuiltins, validateScene,
} from '@nne/core';
import { AssetCache, createGltfSource } from './assets.js';
import { Engine, type Viewport } from './engine.js';
import { createWebGLViewport } from './webgl-viewport.js';

/**
 * Validates then deserializes in one step.
 *
 * Without this, every consumer writes `JSON.parse(text) as SceneFile` after
 * validating — an unchecked cast at exactly the seam validation exists to
 * protect.
 */
export function loadSceneIntoWorld(json: unknown, registry: ComponentRegistry): World {
  const errors = validateScene(json, registry);
  if (errors.length > 0) {
    const detail = errors.map((e) => `${e.path}: ${e.message}`).join('\n  ');
    throw new Error(`invalid scene file:\n  ${detail}`);
  }
  return deserializeScene(json as SceneFile);
}

export interface PlayerOptions {
  canvas: HTMLCanvasElement;
  sceneUrl: string;
  fetchJson?: (url: string) => Promise<unknown>;
  /** Injectable so the one GPU-bound dependency can be faked in tests. */
  createViewport?: (canvas: HTMLCanvasElement) => Viewport;
}

/** Reports the URL and status, so a 404 does not surface as a JSON parse error. */
async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch scene "${url}": ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** Boots a standalone player: no editor, no build step beyond Vite. */
export async function createPlayer(options: PlayerOptions): Promise<Engine> {
  const fetchJson = options.fetchJson ?? defaultFetchJson;

  const registry = new ComponentRegistry();
  registerBuiltins(registry);

  // Everything that can fail cheaply runs before the viewport exists, so those
  // paths need no cleanup at all.
  const world = loadSceneIntoWorld(await fetchJson(options.sceneUrl), registry);

  const viewport = (options.createViewport ?? createWebGLViewport)(options.canvas);
  try {
    const engine = new Engine({ world, assets: new AssetCache(createGltfSource()), viewport });
    engine.resize(options.canvas.clientWidth, options.canvas.clientHeight);
    engine.start();
    return engine;
  } catch (cause) {
    // Browsers cap live WebGL contexts: leaking one per failed boot would make
    // a retry loop die of context exhaustion instead of the real error.
    viewport.dispose();
    throw cause;
  }
}
