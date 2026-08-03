import { beforeEach, describe, expect, it, vi } from 'vitest';
import { World } from '../src/world.js';
import { CommandBus } from '../src/commands.js';

describe('CommandBus', () => {
  let world: World;
  let bus: CommandBus;
  beforeEach(() => { world = new World(); bus = new CommandBus(world); });

  it('spawns an entity at the allocated id', () => {
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'Chaise', parent: null });
    expect(world.alive(id)).toBe(true);
    expect(world.getName(id)).toBe('Chaise');
  });

  it('undoes a spawn', () => {
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'Chaise', parent: null });
    expect(bus.undo()).toBe(true);
    expect(world.alive(id)).toBe(false);
  });

  it('redoes a spawn at the same id', () => {
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'Chaise', parent: null });
    bus.undo();
    expect(bus.redo()).toBe(true);
    expect(world.alive(id)).toBe(true);
    expect(world.getName(id)).toBe('Chaise');
  });

  it('undoes a component change back to its previous data', () => {
    const e = world.spawn();
    world.set(e, 'Mesh', { asset: 'a.glb' });
    bus.dispatch({ kind: 'SetComponent', entity: e, type: 'Mesh', data: { asset: 'b.glb' } });
    expect(world.get(e, 'Mesh')).toEqual({ asset: 'b.glb' });
    bus.undo();
    expect(world.get(e, 'Mesh')).toEqual({ asset: 'a.glb' });
  });

  it('undoes a component that did not exist by removing it', () => {
    const e = world.spawn();
    bus.dispatch({ kind: 'SetComponent', entity: e, type: 'Mesh', data: { asset: 'a.glb' } });
    bus.undo();
    expect(world.has(e, 'Mesh')).toBe(false);
  });

  it('undoes a component removal', () => {
    const e = world.spawn();
    world.set(e, 'Mesh', { asset: 'a.glb' });
    bus.dispatch({ kind: 'RemoveComponent', entity: e, type: 'Mesh' });
    bus.undo();
    expect(world.get(e, 'Mesh')).toEqual({ asset: 'a.glb' });
  });

  it('undoes a reparent', () => {
    const p1 = world.spawn();
    const p2 = world.spawn();
    const c = world.spawn('C', p1);
    bus.dispatch({ kind: 'SetParent', entity: c, parent: p2 });
    bus.undo();
    expect(world.getParent(c)).toBe(p1);
  });

  it('undoes a rename', () => {
    const e = world.spawn('Avant');
    bus.dispatch({ kind: 'RenameEntity', entity: e, name: 'Apres' });
    bus.undo();
    expect(world.getName(e)).toBe('Avant');
  });

  it('restores a despawned subtree with its components and hierarchy', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    world.set(b, 'Mesh', { asset: 'a.glb' });
    bus.dispatch({ kind: 'DespawnEntity', entity: a });
    expect(world.alive(b)).toBe(false);
    bus.undo();
    expect(world.alive(a)).toBe(true);
    expect(world.getName(b)).toBe('B');
    expect(world.getParent(b)).toBe(a);
    expect(world.get(b, 'Mesh')).toEqual({ asset: 'a.glb' });
  });

  it('reports whether undo and redo are available', () => {
    expect(bus.canUndo()).toBe(false);
    expect(bus.canRedo()).toBe(false);
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'A', parent: null });
    expect(bus.canUndo()).toBe(true);
    bus.undo();
    expect(bus.canUndo()).toBe(false);
    expect(bus.canRedo()).toBe(true);
  });

  it('returns false when there is nothing to undo or redo', () => {
    expect(bus.undo()).toBe(false);
    expect(bus.redo()).toBe(false);
  });

  it('clears the redo stack on a new dispatch', () => {
    const a = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: a, name: 'A', parent: null });
    bus.undo();
    const b = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: b, name: 'B', parent: null });
    expect(bus.canRedo()).toBe(false);
  });

  it('notifies subscribers on dispatch, undo and redo', () => {
    const listener = vi.fn();
    bus.subscribe(listener);
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'A', parent: null });
    bus.undo();
    bus.redo();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);
    unsubscribe();
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'A', parent: null });
    expect(listener).not.toHaveBeenCalled();
  });

  it('adds a component with the provided data', () => {
    const e = world.spawn();
    bus.dispatch({ kind: 'AddComponent', entity: e, type: 'Mesh', data: { asset: null } });
    expect(world.get(e, 'Mesh')).toEqual({ asset: null });
    bus.undo();
    expect(world.has(e, 'Mesh')).toBe(false);
  });

  // --- Additional tests beyond the brief ---

  it('dispatching a SpawnEntity for an already-live id throws and does not corrupt the undo stack', () => {
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'A', parent: null });
    const canUndoBefore = bus.canUndo();
    expect(() =>
      bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'B', parent: null }),
    ).toThrow();
    expect(bus.canUndo()).toBe(canUndoBefore);
    // The original spawn must still undo cleanly.
    expect(bus.undo()).toBe(true);
    expect(world.alive(id)).toBe(false);
  });

  it('undoes a three-level-deep despawn, restoring all levels with parents intact', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    const c = world.spawn('C', b);
    world.set(c, 'Mesh', { asset: 'deep.glb' });
    bus.dispatch({ kind: 'DespawnEntity', entity: a });
    expect(world.alive(a)).toBe(false);
    expect(world.alive(b)).toBe(false);
    expect(world.alive(c)).toBe(false);
    bus.undo();
    expect(world.alive(a)).toBe(true);
    expect(world.alive(b)).toBe(true);
    expect(world.alive(c)).toBe(true);
    expect(world.getParent(a)).toBe(null);
    expect(world.getParent(b)).toBe(a);
    expect(world.getParent(c)).toBe(b);
    expect(world.get(c, 'Mesh')).toEqual({ asset: 'deep.glb' });
  });

  it('supports more than one subscriber, and unsubscribing one leaves the other working', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubscribeA = bus.subscribe(listenerA);
    bus.subscribe(listenerB);
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'A', parent: null });
    unsubscribeA();
    const id2 = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id2, name: 'B', parent: null });
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(2);
  });

  it('redoes a despawn-with-children exactly after undo', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    world.set(b, 'Mesh', { asset: 'a.glb' });
    bus.dispatch({ kind: 'DespawnEntity', entity: a });
    bus.undo();
    expect(bus.redo()).toBe(true);
    expect(world.alive(a)).toBe(false);
    expect(world.alive(b)).toBe(false);
  });
});
