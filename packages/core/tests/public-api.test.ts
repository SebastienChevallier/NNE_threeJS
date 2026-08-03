import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('public API', () => {
  it('exports every documented symbol', () => {
    for (const name of [
      'World', 'ComponentRegistry', 'FIELD_TYPES', 'registerBuiltins',
      'TRANSFORM', 'MESH', 'CAMERA', 'LIGHT', 'LIGHT_TYPES',
      'Scheduler', 'CommandBus', 'applyCommand', 'invertCommand',
      'SCENE_VERSION', 'serializeScene', 'deserializeScene',
      'stringifyScene', 'validateScene',
    ]) {
      expect(core).toHaveProperty(name);
    }
  });

  it('builds a working world from the public API alone', () => {
    const registry = new core.ComponentRegistry();
    core.registerBuiltins(registry);

    const world = new core.World();
    const bus = new core.CommandBus(world);
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'Chaise', parent: null });
    bus.dispatch({
      kind: 'AddComponent', entity: id, type: core.TRANSFORM,
      data: registry.createDefault(core.TRANSFORM),
    });

    const file = core.serializeScene(world, 'Scene_01');
    expect(core.validateScene(file, registry)).toEqual([]);
    expect(core.deserializeScene(file).getName(id)).toBe('Chaise');
  });
});
