import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World.query', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('returns all entities when called with no type', () => {
    const a = world.spawn();
    const b = world.spawn();
    expect(world.query()).toEqual([a, b]);
  });

  it('returns entities holding a single component', () => {
    const a = world.spawn();
    const b = world.spawn();
    world.set(a, 'Mesh', {});
    expect(world.query('Mesh')).toEqual([a]);
    expect(world.query('Mesh')).not.toContain(b);
  });

  it('intersects several components', () => {
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    world.set(a, 'Transform', {});
    world.set(a, 'Mesh', {});
    world.set(b, 'Transform', {});
    world.set(c, 'Mesh', {});
    expect(world.query('Transform', 'Mesh')).toEqual([a]);
  });

  it('returns an empty array for an unknown component', () => {
    world.spawn();
    expect(world.query('Nope')).toEqual([]);
  });

  it('returns results sorted ascending', () => {
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    for (const e of [c, a, b]) world.set(e, 'Mesh', {});
    expect(world.query('Mesh')).toEqual([a, b, c]);
  });

  it('excludes despawned entities', () => {
    const a = world.spawn();
    world.set(a, 'Mesh', {});
    world.despawn(a);
    expect(world.query('Mesh')).toEqual([]);
  });
});
