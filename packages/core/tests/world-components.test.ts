import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World components', () => {
  let world: World;
  let e: number;
  beforeEach(() => { world = new World(); e = world.spawn(); });

  it('sets and reads a component', () => {
    world.set(e, 'Transform', { position: [1, 2, 3] });
    expect(world.get(e, 'Transform')).toEqual({ position: [1, 2, 3] });
  });

  it('returns undefined for a missing component', () => {
    expect(world.get(e, 'Mesh')).toBeUndefined();
  });

  it('reports presence', () => {
    expect(world.has(e, 'Mesh')).toBe(false);
    world.set(e, 'Mesh', { asset: null });
    expect(world.has(e, 'Mesh')).toBe(true);
  });

  it('overwrites on a second set', () => {
    world.set(e, 'Mesh', { asset: 'a.glb' });
    world.set(e, 'Mesh', { asset: 'b.glb' });
    expect(world.get(e, 'Mesh')).toEqual({ asset: 'b.glb' });
  });

  it('removes a component', () => {
    world.set(e, 'Mesh', { asset: null });
    world.remove(e, 'Mesh');
    expect(world.has(e, 'Mesh')).toBe(false);
  });

  it('ignores removing a missing component', () => {
    expect(() => world.remove(e, 'Mesh')).not.toThrow();
  });

  it('stores a defensive copy so callers cannot mutate world state', () => {
    const data = { position: [0, 0, 0] };
    world.set(e, 'Transform', data);
    data.position[0] = 99;
    expect(world.get(e, 'Transform')).toEqual({ position: [0, 0, 0] });
  });

  it('returns a defensive copy on read', () => {
    world.set(e, 'Transform', { position: [0, 0, 0] });
    const read = world.get(e, 'Transform') as { position: number[] };
    read.position[0] = 99;
    expect(world.get(e, 'Transform')).toEqual({ position: [0, 0, 0] });
  });

  it('lists components of an entity with sorted keys', () => {
    world.set(e, 'Mesh', { asset: null });
    world.set(e, 'Camera', { fov: 60 });
    expect(Object.keys(world.componentsOf(e))).toEqual(['Camera', 'Mesh']);
  });

  it('drops components when the entity is despawned', () => {
    world.set(e, 'Mesh', { asset: null });
    world.despawn(e);
    const reborn = world.spawn();
    expect(world.has(reborn, 'Mesh')).toBe(false);
  });

  it('throws when setting on a dead entity', () => {
    expect(() => world.set(99, 'Mesh', {})).toThrow(/unknown entity 99/);
  });
});
