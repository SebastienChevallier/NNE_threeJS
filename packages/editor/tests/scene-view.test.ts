import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Mesh, Object3D, PerspectiveCamera, type Scene } from 'three';
import { AssetCache } from '@nne/runtime';
import { TRANSFORM, type SceneFile } from '@nne/core';
import { EditorSession } from '../src/session.js';
import { createSceneView, type SceneRenderer, type SceneView } from '../src/viewport/scene-view.js';

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [
    {
      id: 1,
      name: 'Chair',
      components: {
        Transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
  ],
};

function fakeRenderer() {
  const calls: { scene: Scene; camera: PerspectiveCamera }[] = [];
  const renderer: SceneRenderer = {
    render(s, c) { calls.push({ scene: s, camera: c }); },
    resize: vi.fn(),
    dispose: vi.fn(),
  };
  return { renderer, calls };
}

function assets(): AssetCache {
  return new AssetCache({ async load() { return new Mesh() as Object3D; } });
}

describe('createSceneView', () => {
  let session: EditorSession;
  let view: SceneView;
  let fake: ReturnType<typeof fakeRenderer>;

  beforeEach(() => {
    session = new EditorSession();
    session.loadScene(scene);
    fake = fakeRenderer();
    view = createSceneView({
      session,
      assets: assets(),
      createRenderer: () => fake.renderer,
    });
  });

  describe('stepping', () => {
    it('syncs the three graph from the world', () => {
      view.step(0.016);
      expect(view.engine.graph.objectOf(1)).toBeDefined();
    });

    it('applies transforms from the components', () => {
      view.step(0.016);
      expect(view.engine.graph.objectOf(1)?.position.toArray()).toEqual([1, 2, 3]);
    });

    it('renders through the edit camera, not the scene camera', () => {
      // The Engine is built without a viewport precisely so that it never
      // renders through the scene's active camera; the Scene View renders
      // itself, through the camera the user is flying.
      view.step(0.016);
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]?.camera).toBe(view.camera);
    });

    it('renders even when the scene has no camera entity at all', () => {
      view.step(0.016);
      expect(view.engine.activeCamera()).toBeUndefined();
      expect(fake.calls).toHaveLength(1);
    });

    it('runs headless when no renderer is provided', () => {
      const headless = createSceneView({ session, assets: assets() });
      expect(() => headless.step(0.016)).not.toThrow();
      expect(headless.engine.graph.objectOf(1)).toBeDefined();
    });
  });

  describe('the edit layer', () => {
    it('lives in the scene but outside the entities root', () => {
      expect(view.engine.scene.children).toContain(view.editLayer);
      expect(view.engine.graph.objectOf(1)?.parent).not.toBe(view.editLayer);
    });

    it('survives a graph sync, which only manages the entities root', () => {
      const marker = new Object3D();
      view.editLayer.add(marker);
      view.step(0.016);
      view.step(0.016);
      expect(marker.parent).toBe(view.editLayer);
      expect(view.engine.scene.children).toContain(view.editLayer);
    });

    it('holds a grid', () => {
      expect(view.editLayer.children.length).toBeGreaterThan(0);
    });
  });

  describe('resize', () => {
    it('updates the edit camera aspect', () => {
      view.resize(800, 400);
      expect(view.camera.aspect).toBe(2);
    });

    it('passes the size to the renderer', () => {
      view.resize(800, 400);
      expect(fake.renderer.resize).toHaveBeenCalledWith(800, 400);
    });

    it('survives a zero-sized container without producing NaN', () => {
      // A collapsed panel reports 0; an aspect of NaN poisons the projection
      // matrix and the viewport never recovers, even after a real resize.
      view.resize(0, 0);
      expect(Number.isFinite(view.camera.aspect)).toBe(true);
    });
  });

  describe('setWorld', () => {
    it('rebuilds the graph for a newly loaded scene', () => {
      session.loadScene({
        version: 1,
        name: 'Other',
        entities: [{ id: 7, name: 'New', components: {} }],
      });
      view.setWorld(session.world);
      view.step(0.016);

      expect(view.engine.graph.objectOf(7)).toBeDefined();
      expect(view.engine.graph.objectOf(1)).toBeUndefined();
    });

    it('keeps the edit layer across the rebuild', () => {
      const marker = new Object3D();
      view.editLayer.add(marker);
      session.loadScene({ version: 1, name: 'Other', entities: [] });
      view.setWorld(session.world);

      expect(view.engine.scene.children).toContain(view.editLayer);
      expect(marker.parent).toBe(view.editLayer);
    });

    it('keeps the edit camera, so the user does not lose their viewpoint', () => {
      const camera = view.camera;
      view.camera.position.set(5, 5, 5);
      session.loadScene({ version: 1, name: 'Other', entities: [] });
      view.setWorld(session.world);

      expect(view.camera).toBe(camera);
      expect(view.camera.position.toArray()).toEqual([5, 5, 5]);
    });
  });

  describe('dispose', () => {
    it('releases the renderer', () => {
      view.dispose();
      expect(fake.renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it('is safe to call twice', () => {
      view.dispose();
      view.dispose();
      expect(fake.renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it('stops rendering after dispose', () => {
      view.dispose();
      view.step(0.016);
      expect(fake.calls).toHaveLength(0);
    });
  });
});
