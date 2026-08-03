import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComponentRegistry, MESH, TRANSFORM, registerBuiltins } from '@nne/core';
import type { Viewport } from '../src/engine.js';
import { createPlayer, loadSceneIntoWorld } from '../src/player.js';

function registry(): ComponentRegistry {
  const r = new ComponentRegistry();
  registerBuiltins(r);
  return r;
}

const valid = {
  version: 1,
  name: 'Scene_01',
  entities: [
    { id: 1, name: 'Root', components: {} },
    {
      id: 2, name: 'Chair', parent: 1,
      components: {
        Mesh: { asset: 'a.glb', castShadow: true },
        Transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
  ],
};

describe('loadSceneIntoWorld', () => {
  it('builds a world from a valid scene', () => {
    const world = loadSceneIntoWorld(valid, registry());
    expect(world.entities()).toEqual([1, 2]);
    expect(world.getName(2)).toBe('Chair');
    expect(world.getParent(2)).toBe(1);
    expect(world.get(2, MESH)).toEqual({ asset: 'a.glb', castShadow: true });
    expect(world.get(2, TRANSFORM)).toEqual({ position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
  });

  it('throws on an invalid scene rather than returning a broken world', () => {
    const broken = { ...valid, version: 99 };
    expect(() => loadSceneIntoWorld(broken, registry())).toThrow(/version/);
  });

  it('reports every validation error, not just the first', () => {
    const broken = {
      version: 1, name: 'X',
      entities: [{ id: 1, name: 'A', components: { Mesh: { asset: 1, castShadow: 'no' } } }],
    };
    try {
      loadSceneIntoWorld(broken, registry());
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toMatch(/asset/);
      expect((error as Error).message).toMatch(/castShadow/);
    }
  });

  it('includes the error paths in the message', () => {
    const broken = { ...valid, name: 42 };
    expect(() => loadSceneIntoWorld(broken, registry())).toThrow(/scene\.name/);
  });

  it('rejects a cyclic scene before it reaches the world', () => {
    const cyclic = {
      version: 1, name: 'Cycle',
      entities: [
        { id: 1, name: 'A', parent: 2, components: {} },
        { id: 2, name: 'B', parent: 1, components: {} },
      ],
    };
    expect(() => loadSceneIntoWorld(cyclic, registry())).toThrow(/cycle/);
  });

  it('advances the id counter past the loaded entities', () => {
    const world = loadSceneIntoWorld(valid, registry());
    expect(world.spawn()).toBe(3);
  });
});

function fakeViewport(overrides: Partial<Viewport> = {}): Viewport {
  return {
    render: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

function fakeCanvas(width = 800, height = 600): HTMLCanvasElement {
  return { clientWidth: width, clientHeight: height } as unknown as HTMLCanvasElement;
}

describe('createPlayer', () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCaf = globalThis.cancelAnimationFrame;

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
  });

  /** Node has no rAF; the loop must never actually run in a unit test. */
  function stubRaf(impl: () => number = () => 1): void {
    globalThis.requestAnimationFrame = vi.fn(impl) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn() as unknown as typeof cancelAnimationFrame;
  }

  it('boots a running engine from a fetched scene', async () => {
    stubRaf();
    const viewport = fakeViewport();
    const engine = await createPlayer({
      canvas: fakeCanvas(),
      sceneUrl: '/scene.json',
      fetchJson: async () => valid,
      createViewport: () => viewport,
    });

    expect(engine.world.getName(2)).toBe('Chair');
    expect(viewport.resize).toHaveBeenCalledWith(800, 600);
    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
    engine.stop();
  });

  it('passes the canvas to createViewport and raw client dimensions through', async () => {
    stubRaf();
    const canvas = fakeCanvas(0, 0);
    const viewport = fakeViewport();
    const createViewport = vi.fn(() => viewport);
    const engine = await createPlayer({
      canvas, sceneUrl: '/s.json', fetchJson: async () => valid, createViewport,
    });

    expect(createViewport).toHaveBeenCalledWith(canvas);
    // Raw zeroes reach the viewport; only the camera aspect is clamped.
    expect(viewport.resize).toHaveBeenCalledWith(0, 0);
    engine.stop();
  });

  it('disposes the viewport when engine startup fails', async () => {
    stubRaf(() => { throw new Error('no frame budget'); });
    const viewport = fakeViewport();

    await expect(createPlayer({
      canvas: fakeCanvas(),
      sceneUrl: '/s.json',
      fetchJson: async () => valid,
      createViewport: () => viewport,
    })).rejects.toThrow(/no frame budget/);

    expect(viewport.dispose).toHaveBeenCalledTimes(1);
  });

  it('never creates a viewport when the scene is invalid', async () => {
    const createViewport = vi.fn(() => fakeViewport());
    await expect(createPlayer({
      canvas: fakeCanvas(),
      sceneUrl: '/s.json',
      fetchJson: async () => ({ ...valid, version: 99 }),
      createViewport,
    })).rejects.toThrow(/version/);
    expect(createViewport).not.toHaveBeenCalled();
  });

  it('never creates a viewport when the fetch rejects', async () => {
    const createViewport = vi.fn(() => fakeViewport());
    await expect(createPlayer({
      canvas: fakeCanvas(),
      sceneUrl: '/s.json',
      fetchJson: async () => { throw new Error('offline'); },
      createViewport,
    })).rejects.toThrow(/offline/);
    expect(createViewport).not.toHaveBeenCalled();
  });

  it('reports a readable error for a non-ok fetch response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => { throw new SyntaxError("Unexpected token '<'"); },
    } as unknown as Response);

    try {
      await expect(createPlayer({
        canvas: fakeCanvas(),
        sceneUrl: '/missing.json',
        createViewport: () => fakeViewport(),
      })).rejects.toThrow('failed to fetch scene "/missing.json": 404 Not Found');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
