import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Mesh, Object3D, PerspectiveCamera, type Scene } from 'three';
import { AssetCache } from '@nne/runtime';
import { CAMERA, MESH, TRANSFORM, World, serializeScene, type SceneFile } from '@nne/core';
import { EditorSession } from '../src/session.js';
import { cloneWorld, createGameView, type GameView } from '../src/viewport/game-view.js';
import type { SceneRenderer } from '../src/viewport/scene-view.js';

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [
    {
      id: 1,
      name: 'Camera',
      components: {
        Camera: { fov: 60, near: 0.1, far: 1000, active: true },
        Transform: { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
    {
      id: 2,
      name: 'Chair',
      parent: 1,
      components: {
        Mesh: { asset: 'props/PRP_Chair_01.glb', castShadow: true },
        Transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
  ],
};

function assets(): AssetCache {
  return new AssetCache({ async load() { return new Mesh() as Object3D; } });
}

function fakeRenderer() {
  const calls: { scene: Scene; camera: PerspectiveCamera }[] = [];
  const renderer: SceneRenderer = {
    render(s, c) { calls.push({ scene: s, camera: c }); },
    resize: vi.fn(),
    dispose: vi.fn(),
  };
  return { renderer, calls };
}

describe('cloneWorld', () => {
  it('reproduces every entity, name and parent', () => {
    const source = new World();
    const a = source.spawn('A');
    source.spawn('B', a);
    const clone = cloneWorld(source);

    expect(clone.entities()).toEqual(source.entities());
    expect(clone.getName(a)).toBe('A');
    expect(clone.getParent(2)).toBe(a);
  });

  it('preserves entity ids, so a selection survives a Stop', () => {
    const source = new World();
    source.spawn('A');
    source.spawn('B');
    expect(cloneWorld(source).entities()).toEqual([1, 2]);
  });

  it('reproduces component data', () => {
    const source = new World();
    const e = source.spawn('A');
    source.set(e, TRANSFORM, { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(cloneWorld(source).peek(e, TRANSFORM)).toMatchObject({ position: [1, 2, 3] });
  });

  it('shares nothing: mutating the clone leaves the source untouched', () => {
    const source = new World();
    const e = source.spawn('A');
    source.set(e, TRANSFORM, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

    const clone = cloneWorld(source);
    clone.set(e, TRANSFORM, { position: [9, 9, 9], rotation: [0, 0, 0], scale: [1, 1, 1] });
    clone.despawn(e);

    expect(source.alive(e)).toBe(true);
    expect(source.peek(e, TRANSFORM)).toMatchObject({ position: [0, 0, 0] });
  });

  it('round-trips an empty world', () => {
    expect(cloneWorld(new World()).entities()).toEqual([]);
  });
});

describe('createGameView', () => {
  let session: EditorSession;
  let view: GameView;
  let fake: ReturnType<typeof fakeRenderer>;

  beforeEach(() => {
    session = new EditorSession();
    session.loadScene(scene);
    fake = fakeRenderer();
    view = createGameView({
      session,
      assets: assets(),
      createRenderer: () => fake.renderer,
    });
  });

  describe('play', () => {
    it('runs on a clone, not on the edited world', () => {
      view.play();
      expect(view.world).toBeDefined();
      expect(view.world).not.toBe(session.world);
    });

    it('renders through the scene camera, not an edit camera', () => {
      view.play();
      view.step(0.016);
      expect(fake.calls[0]?.camera).toBeInstanceOf(PerspectiveCamera);
      expect(fake.calls[0]?.camera.fov).toBe(60);
    });

    it('leaves the edited world untouched however hard the clone is mutated', () => {
      const before = serializeScene(session.world, 'Scene_01');
      view.play();
      const played = view.world as World;

      played.set(1, TRANSFORM, { position: [99, 99, 99], rotation: [0, 0, 0], scale: [1, 1, 1] });
      played.remove(2, MESH);
      played.despawn(2);
      played.spawn('Spawned at runtime');
      view.step(0.016);

      expect(serializeScene(session.world, 'Scene_01')).toEqual(before);
    });

    it('is a no-op when already playing', () => {
      view.play();
      const first = view.world;
      view.play();
      expect(view.world).toBe(first);
    });
  });

  describe('stop', () => {
    it('throws the clone away', () => {
      view.play();
      view.stop();
      expect(view.world).toBeUndefined();
    });

    it('renders nothing once stopped', () => {
      view.play();
      view.stop();
      view.step(0.016);
      expect(fake.calls).toHaveLength(0);
    });

    it('is a no-op when not playing', () => {
      expect(() => view.stop()).not.toThrow();
    });

    it('starts a second play from the edited state, not from where the first ended', () => {
      view.play();
      (view.world as World).set(1, TRANSFORM, {
        position: [99, 99, 99], rotation: [0, 0, 0], scale: [1, 1, 1],
      });
      view.stop();

      view.play();
      expect((view.world as World).peek(1, TRANSFORM)).toMatchObject({ position: [0, 1.6, 5] });
    });
  });

  describe('step', () => {
    it('does nothing before play', () => {
      view.step(0.016);
      expect(fake.calls).toHaveLength(0);
    });

    it('syncs the graph of the played world', () => {
      view.play();
      view.step(0.016);
      expect(view.engine?.graph.objectOf(1)).toBeDefined();
    });

    it('renders nothing when the played scene has no active camera', () => {
      // Without a camera there is nothing to render through; the frame is
      // skipped rather than crashing on an undefined camera.
      session.loadScene({ version: 1, name: 'S', entities: [] });
      view.play();
      view.step(0.016);
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe('resize', () => {
    it('passes the size to the renderer', () => {
      view.play();
      view.resize(800, 400);
      expect(fake.renderer.resize).toHaveBeenCalledWith(800, 400);
    });

    it('is safe before play', () => {
      expect(() => view.resize(800, 400)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('stops play and releases the renderer', () => {
      view.play();
      view.dispose();
      expect(view.world).toBeUndefined();
      expect(fake.renderer.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
