import { describe, expect, it } from 'vitest';
import { World } from '../src/world.js';
import { CommandBus, type Command } from '../src/commands.js';
import { serializeScene, stringifyScene } from '../src/scene.js';

/** A world with a hierarchy and components, rebuilt fresh for each case. */
function fixture(): World {
  const world = new World();
  const root = world.spawn('Root');
  world.set(root, 'Transform', { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  const child = world.spawn('Child', root);
  world.set(child, 'Transform', { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
  world.set(child, 'Mesh', { asset: 'assets/PRP_Chair_01.glb', castShadow: true });
  const grandchild = world.spawn('Grandchild', child);
  world.set(grandchild, 'Mesh', { asset: null, castShadow: false });
  world.spawn('Sibling', root);
  return world;
}

function snapshot(world: World): string {
  return stringifyScene(serializeScene(world, 'snapshot'));
}

const cases: { name: string; command: (world: World) => Command }[] = [
  { name: 'SpawnEntity at root',
    command: (w) => ({ kind: 'SpawnEntity', entity: w.allocateId(), name: 'New', parent: null }) },
  { name: 'SpawnEntity under a parent',
    command: (w) => ({ kind: 'SpawnEntity', entity: w.allocateId(), name: 'New', parent: 1 }) },
  { name: 'DespawnEntity leaf',
    command: () => ({ kind: 'DespawnEntity', entity: 3 }) },
  { name: 'DespawnEntity with a subtree',
    command: () => ({ kind: 'DespawnEntity', entity: 2 }) },
  { name: 'SetComponent over an existing one',
    command: () => ({ kind: 'SetComponent', entity: 2, type: 'Mesh', data: { asset: 'x.glb', castShadow: false } }) },
  { name: 'SetComponent creating a new one',
    command: () => ({ kind: 'SetComponent', entity: 1, type: 'Mesh', data: { asset: null, castShadow: true } }) },
  { name: 'AddComponent',
    command: () => ({ kind: 'AddComponent', entity: 4, type: 'Mesh', data: { asset: null, castShadow: true } }) },
  { name: 'RemoveComponent present',
    command: () => ({ kind: 'RemoveComponent', entity: 2, type: 'Mesh' }) },
  { name: 'RemoveComponent absent',
    command: () => ({ kind: 'RemoveComponent', entity: 4, type: 'Mesh' }) },
  { name: 'SetParent to another entity',
    command: () => ({ kind: 'SetParent', entity: 3, parent: 4 }) },
  { name: 'SetParent to root',
    command: () => ({ kind: 'SetParent', entity: 2, parent: null }) },
  { name: 'RenameEntity',
    command: () => ({ kind: 'RenameEntity', entity: 2, name: 'Renamed' }) },
];

describe('command inversion', () => {
  for (const { name, command } of cases) {
    it(`restores the world exactly after undoing: ${name}`, () => {
      const world = fixture();
      const before = snapshot(world);
      const bus = new CommandBus(world);

      bus.dispatch(command(world));
      expect(bus.undo()).toBe(true);

      expect(snapshot(world)).toBe(before);
    });

    it(`reapplies identically after redo: ${name}`, () => {
      const world = fixture();
      const bus = new CommandBus(world);

      bus.dispatch(command(world));
      const afterDispatch = snapshot(world);
      bus.undo();
      bus.redo();

      expect(snapshot(world)).toBe(afterDispatch);
    });
  }

  it('restores the world after undoing a long sequence', () => {
    const world = fixture();
    const before = snapshot(world);
    const bus = new CommandBus(world);

    // Hand-ordered so every command stays valid against the previous one:
    // nothing targets an entity a prior despawn removed.
    const spawned = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: spawned, name: 'New', parent: 1 });
    bus.dispatch({ kind: 'RenameEntity', entity: 2, name: 'Renamed' });
    bus.dispatch({ kind: 'SetComponent', entity: 2, type: 'Mesh', data: { asset: 'x.glb', castShadow: false } });
    bus.dispatch({ kind: 'AddComponent', entity: 4, type: 'Mesh', data: { asset: null, castShadow: true } });
    bus.dispatch({ kind: 'SetParent', entity: 3, parent: 4 });
    bus.dispatch({ kind: 'RemoveComponent', entity: 2, type: 'Mesh' });
    bus.dispatch({ kind: 'DespawnEntity', entity: 4 });
    bus.dispatch({ kind: 'SetParent', entity: 2, parent: null });

    while (bus.canUndo()) bus.undo();

    expect(snapshot(world)).toBe(before);
  });
});
