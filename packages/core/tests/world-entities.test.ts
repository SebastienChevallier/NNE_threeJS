import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World entity lifecycle', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('spawns entities with increasing ids starting at 1', () => {
    expect(world.spawn()).toBe(1);
    expect(world.spawn()).toBe(2);
  });

  it('gives spawned entities a default name', () => {
    const e = world.spawn();
    expect(world.getName(e)).toBe('Entity 1');
  });

  it('keeps the provided name', () => {
    const e = world.spawn('Chaise');
    expect(world.getName(e)).toBe('Chaise');
  });

  it('renames an entity', () => {
    const e = world.spawn('Chaise');
    world.setName(e, 'Table');
    expect(world.getName(e)).toBe('Table');
  });

  it('reports liveness', () => {
    const e = world.spawn();
    expect(world.alive(e)).toBe(true);
    world.despawn(e);
    expect(world.alive(e)).toBe(false);
  });

  it('lists live entities sorted ascending', () => {
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    world.despawn(b);
    expect(world.entities()).toEqual([a, c]);
  });

  it('never reuses an id after despawn', () => {
    const a = world.spawn();
    world.despawn(a);
    expect(world.spawn()).toBe(2);
  });

  it('allocates an id without spawning', () => {
    const id = world.allocateId();
    expect(id).toBe(1);
    expect(world.alive(id)).toBe(false);
    expect(world.spawn()).toBe(2);
  });

  it('spawns with an explicit id and advances the counter past it', () => {
    world.spawnWithId(42, 'Importee', null);
    expect(world.alive(42)).toBe(true);
    expect(world.getName(42)).toBe('Importee');
    expect(world.spawn()).toBe(43);
  });

  it('throws when spawning an id that is already live', () => {
    world.spawnWithId(7, 'A', null);
    expect(() => world.spawnWithId(7, 'B', null)).toThrow(/already live/);
  });

  it('throws when reading a dead entity', () => {
    expect(() => world.getName(99)).toThrow(/unknown entity 99/);
  });

  it('ignores despawning a dead entity', () => {
    expect(() => world.despawn(99)).not.toThrow();
  });

  it('returns sorted ascending when insertion order differs', () => {
    world.spawnWithId(5, 'E', null);
    world.spawnWithId(2, 'B', null);
    world.spawnWithId(8, 'H', null);
    world.spawnWithId(1, 'A', null);
    expect(world.entities()).toEqual([1, 2, 5, 8]);
  });

  it('spawnWithId with id below counter does not advance counter', () => {
    world.allocateId();
    world.allocateId();
    world.allocateId();
    const beforeCounter = world.spawn(); // counter was at 4, now at 5
    world.despawn(beforeCounter);
    world.spawnWithId(2, 'Two', null);
    expect(world.spawn()).toBe(5);
  });
});
