import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World.peek', () => {
  let world: World;
  let e: number;
  beforeEach(() => { world = new World(); e = world.spawn(); });

  it('reads the same value as get', () => {
    world.set(e, 'Transform', { position: [1, 2, 3] });
    expect(world.peek(e, 'Transform')).toEqual(world.get(e, 'Transform'));
  });

  it('returns undefined for a missing component', () => {
    expect(world.peek(e, 'Mesh')).toBeUndefined();
  });

  it('does NOT copy: two peeks return the same object', () => {
    world.set(e, 'Transform', { position: [0, 0, 0] });
    expect(world.peek(e, 'Transform')).toBe(world.peek(e, 'Transform'));
  });

  it('get still copies, unlike peek', () => {
    world.set(e, 'Transform', { position: [0, 0, 0] });
    expect(world.get(e, 'Transform')).not.toBe(world.get(e, 'Transform'));
  });

  it('throws on a dead entity', () => {
    expect(() => world.peek(99, 'Transform')).toThrow(/unknown entity 99/);
  });

  it('reflects a later set without re-peeking', () => {
    world.set(e, 'Transform', { position: [0, 0, 0] });
    world.set(e, 'Transform', { position: [9, 9, 9] });
    expect(world.peek(e, 'Transform')).toEqual({ position: [9, 9, 9] });
  });
});
