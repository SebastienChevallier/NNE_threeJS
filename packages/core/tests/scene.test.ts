import { describe, expect, it } from 'vitest';
import { World } from '../src/world.js';
import {
  SCENE_VERSION, deserializeScene, serializeScene, stringifyScene,
} from '../src/scene.js';

function sampleWorld(): World {
  const world = new World();
  const cam = world.spawn('Camera principale');
  world.set(cam, 'Transform', { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] });
  world.set(cam, 'Camera', { fov: 60, near: 0.1, far: 1000, active: true });
  const chair = world.spawn('Chaise', cam);
  world.set(chair, 'Mesh', { asset: 'assets/PRP_Chair_01.glb', castShadow: true });
  return world;
}

describe('scene serialization', () => {
  it('writes the current scene version', () => {
    expect(serializeScene(new World(), 'Empty').version).toBe(SCENE_VERSION);
  });

  it('writes the scene name', () => {
    expect(serializeScene(new World(), 'Scene_01').name).toBe('Scene_01');
  });

  it('serializes entities with id, name and components', () => {
    const file = serializeScene(sampleWorld(), 'Scene_01');
    expect(file.entities[0]).toEqual({
      id: 1,
      name: 'Camera principale',
      components: {
        Camera: { fov: 60, near: 0.1, far: 1000, active: true },
        Transform: { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    });
  });

  it('omits parent for root entities and writes it for children', () => {
    const file = serializeScene(sampleWorld(), 'Scene_01');
    expect(file.entities[0]).not.toHaveProperty('parent');
    expect(file.entities[1]?.parent).toBe(1);
  });

  it('sorts entities by id', () => {
    const file = serializeScene(sampleWorld(), 'Scene_01');
    expect(file.entities.map((e) => e.id)).toEqual([1, 2]);
  });

  it('restores entities, names, hierarchy and components', () => {
    const world = deserializeScene(serializeScene(sampleWorld(), 'Scene_01'));
    expect(world.entities()).toEqual([1, 2]);
    expect(world.getName(1)).toBe('Camera principale');
    expect(world.getParent(2)).toBe(1);
    expect(world.get(2, 'Mesh')).toEqual({ asset: 'assets/PRP_Chair_01.glb', castShadow: true });
  });

  it('advances the id counter past the loaded entities', () => {
    const world = deserializeScene(serializeScene(sampleWorld(), 'Scene_01'));
    expect(world.spawn()).toBe(3);
  });

  it('restores a child declared before its parent', () => {
    const world = deserializeScene({
      version: SCENE_VERSION,
      name: 'OutOfOrder',
      entities: [
        { id: 2, name: 'Child', parent: 1, components: {} },
        { id: 1, name: 'Parent', components: {} },
      ],
    });
    expect(world.getParent(2)).toBe(1);
  });

  it('round-trips byte for byte', () => {
    const once = stringifyScene(serializeScene(sampleWorld(), 'Scene_01'));
    const twice = stringifyScene(serializeScene(deserializeScene(JSON.parse(once)), 'Scene_01'));
    expect(twice).toBe(once);
  });

  it('stringifies with sorted component keys and two-space indent', () => {
    const text = stringifyScene(serializeScene(sampleWorld(), 'Scene_01'));
    expect(text.indexOf('"Camera"')).toBeLessThan(text.indexOf('"Transform"'));
    expect(text).toContain('\n  "version": 1');
    expect(text.endsWith('\n')).toBe(true);
  });
});
