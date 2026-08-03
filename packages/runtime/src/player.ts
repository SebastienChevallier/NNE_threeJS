import {
  ComponentRegistry, type SceneFile, type World,
  deserializeScene, registerBuiltins, validateScene,
} from '@nne/core';
import { AssetCache, createGltfSource } from './assets.js';
import { Engine } from './engine.js';
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
}

/** Boots a standalone player: no editor, no build step beyond Vite. */
export async function createPlayer(options: PlayerOptions): Promise<Engine> {
  const fetchJson = options.fetchJson ?? (async (url: string): Promise<unknown> => (await fetch(url)).json());

  const registry = new ComponentRegistry();
  registerBuiltins(registry);

  const world = loadSceneIntoWorld(await fetchJson(options.sceneUrl), registry);
  const engine = new Engine({
    world,
    assets: new AssetCache(createGltfSource()),
    viewport: createWebGLViewport(options.canvas),
  });

  engine.resize(options.canvas.clientWidth || 1, options.canvas.clientHeight || 1);
  engine.start();
  return engine;
}
