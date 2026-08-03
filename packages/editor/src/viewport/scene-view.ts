import { GridHelper, Object3D, PerspectiveCamera, type Scene } from 'three';
import type { World } from '@nne/core';
import { AssetCache, Engine } from '@nne/runtime';
import type { EditorSession } from '../session.js';

/** The one GPU-bound dependency, behind a narrow interface. */
export interface SceneRenderer {
  render(scene: Scene, camera: PerspectiveCamera): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface SceneViewOptions {
  session: EditorSession;
  assets: AssetCache;
  /** Omit to run headless, e.g. in tests. */
  createRenderer?: () => SceneRenderer;
}

export interface SceneView {
  readonly engine: Engine;
  readonly camera: PerspectiveCamera;
  /** Grid, helpers and gizmo. Lives outside the entities root. */
  readonly editLayer: Object3D;
  step(dt: number): void;
  resize(width: number, height: number): void;
  /** Rebuilds the engine onto a new world, e.g. after loading a scene. */
  setWorld(world: World): void;
  dispose(): void;
}

/**
 * The editing viewport.
 *
 * Drives an `Engine` built **without a viewport** and renders it itself. An
 * Engine with no viewport still syncs the three graph from the World and runs
 * every system, but draws nothing — which is exactly what is wanted here: the
 * Scene View wants the runtime's World-to-graph synchronisation, rendered
 * through the *edit* camera rather than through the scene's active camera.
 *
 * This is why the editor needs no change to `runtime`: the seam already existed.
 */
export function createSceneView(options: SceneViewOptions): SceneView {
  const { session, assets } = options;
  const renderer = options.createRenderer?.();

  const camera = new PerspectiveCamera(60, 1, 0.1, 2000);
  camera.position.set(5, 5, 5);
  camera.lookAt(0, 0, 0);

  // Everything the runtime knows nothing about. Added to the scene directly,
  // never under the entities root, so `SceneGraph.sync` neither sees it nor
  // destroys it.
  const editLayer = new Object3D();
  editLayer.name = 'edit-layer';
  const grid = new GridHelper(50, 50);
  editLayer.add(grid);

  let engine = buildEngine(session.world);
  let disposed = false;
  let width = 1;
  let height = 1;

  function buildEngine(world: World): Engine {
    const built = new Engine({ world, assets });
    built.scene.add(editLayer);
    return built;
  }

  return {
    get engine() {
      return engine;
    },
    camera,
    editLayer,

    step(dt: number): void {
      if (disposed) return;
      engine.step(dt);
      renderer?.render(engine.scene, camera);
    },

    resize(w: number, h: number): void {
      // A collapsed panel reports 0, and an aspect of NaN poisons the
      // projection matrix for good — a later real resize does not undo it.
      width = Math.max(1, w);
      height = Math.max(1, h);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer?.resize(w, h);
    },

    setWorld(world: World): void {
      // The old engine's graph mirrors a world that is gone. The edit layer and
      // the camera are deliberately carried over: the user keeps their
      // viewpoint across a scene load.
      engine.dispose();
      editLayer.removeFromParent();
      engine = buildEngine(world);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      engine.dispose();
      renderer?.dispose();
    },
  };
}
