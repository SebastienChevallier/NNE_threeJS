import { describe, expect, it } from 'vitest';
import { ComponentRegistry, MESH, TRANSFORM, registerBuiltins } from '@nne/core';
import { loadSceneIntoWorld } from '../src/player.js';

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
