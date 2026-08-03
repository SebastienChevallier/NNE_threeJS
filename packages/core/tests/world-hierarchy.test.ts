import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World hierarchy', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('spawns at the root by default', () => {
    const e = world.spawn();
    expect(world.getParent(e)).toBeNull();
  });

  it('spawns under a parent', () => {
    const p = world.spawn('Parent');
    const c = world.spawn('Child', p);
    expect(world.getParent(c)).toBe(p);
    expect(world.children(p)).toEqual([c]);
  });

  it('lists children sorted ascending', () => {
    const p = world.spawn();
    const a = world.spawn('A', p);
    const b = world.spawn('B', p);
    expect(world.children(p)).toEqual([a, b]);
  });

  it('reparents an entity and updates both child lists', () => {
    const p1 = world.spawn();
    const p2 = world.spawn();
    const c = world.spawn('C', p1);
    world.setParent(c, p2);
    expect(world.getParent(c)).toBe(p2);
    expect(world.children(p1)).toEqual([]);
    expect(world.children(p2)).toEqual([c]);
  });

  it('unparents to the root', () => {
    const p = world.spawn();
    const c = world.spawn('C', p);
    world.setParent(c, null);
    expect(world.getParent(c)).toBeNull();
    expect(world.children(p)).toEqual([]);
  });

  it('refuses to parent an entity to itself', () => {
    const e = world.spawn();
    expect(() => world.setParent(e, e)).toThrow(/cycle/);
  });

  it('refuses to create a cycle through a descendant', () => {
    const a = world.spawn();
    const b = world.spawn('B', a);
    const c = world.spawn('C', b);
    expect(() => world.setParent(a, c)).toThrow(/cycle/);
  });

  it('returns the subtree with parents before children', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    const c = world.spawn('C', b);
    const d = world.spawn('D', a);
    expect(world.subtree(a)).toEqual([a, b, d, c]);
  });

  it('despawns the whole subtree', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    const c = world.spawn('C', b);
    const other = world.spawn('Other');
    world.despawn(a);
    expect(world.alive(a)).toBe(false);
    expect(world.alive(b)).toBe(false);
    expect(world.alive(c)).toBe(false);
    expect(world.alive(other)).toBe(true);
  });

  it('removes a despawned child from its parent list', () => {
    const p = world.spawn();
    const c = world.spawn('C', p);
    world.despawn(c);
    expect(world.children(p)).toEqual([]);
  });

  it('throws when parenting to a dead entity', () => {
    const e = world.spawn();
    expect(() => world.setParent(e, 99)).toThrow(/unknown entity 99/);
  });
});
