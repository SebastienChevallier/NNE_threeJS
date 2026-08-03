import { deserializeScene, serializeScene, type World } from '@nne/core';
import { AssetCache, Engine } from '@nne/runtime';
import type { EditorSession } from '../session.js';
import type { SceneRenderer } from './scene-view.js';

export interface GameViewOptions {
  session: EditorSession;
  assets: AssetCache;
  /** Omit to run headless, e.g. in tests. */
  createRenderer?: () => SceneRenderer;
}

export interface GameView {
  /** The played world, or undefined when stopped. */
  readonly world: World | undefined;
  readonly engine: Engine | undefined;
  play(): void;
  stop(): void;
  step(dt: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * A deep, independent copy of a world.
 *
 * Done by a serialize/deserialize round trip rather than by hand: `core` already
 * proves that round trip byte-stable, and a second copying implementation would
 * be one more thing to keep in step with the component format.
 */
export function cloneWorld(world: World): World {
  return deserializeScene(serializeScene(world, 'clone'));
}

/**
 * The Game View: the same systems as the runtime, on a clone of the world,
 * rendered through the scene's own active camera and with no edit layer.
 *
 * Playing never touches the edited scene — Play clones, Stop throws the clone
 * away. A second Play therefore starts from the edited state again, not from
 * wherever the last session left off.
 */
export function createGameView(options: GameViewOptions): GameView {
  const { session, assets } = options;
  let renderer: SceneRenderer | undefined;
  let engine: Engine | undefined;
  let world: World | undefined;
  let width = 1;
  let height = 1;

  return {
    get world() {
      return world;
    },
    get engine() {
      return engine;
    },

    play(): void {
      if (world) return;
      world = cloneWorld(session.world);
      engine = new Engine({ world, assets });
      renderer ??= options.createRenderer?.();
      engine.resize(width, height);
    },

    stop(): void {
      if (!world) return;
      engine?.dispose();
      engine = undefined;
      world = undefined;
    },

    step(dt: number): void {
      if (!engine) return;
      engine.step(dt);
      const camera = engine.activeCamera();
      // No active camera means there is nothing to render through. Skipped
      // rather than crashed: a scene without a camera is a normal work state.
      if (camera) renderer?.render(engine.scene, camera);
    },

    resize(w: number, h: number): void {
      width = Math.max(1, w);
      height = Math.max(1, h);
      engine?.resize(w, h);
      renderer?.resize(w, h);
    },

    dispose(): void {
      this.stop();
      renderer?.dispose();
      renderer = undefined;
    },
  };
}
