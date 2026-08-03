import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/registry.js';
import { registerBuiltins } from '../src/builtins.js';
import { SCENE_VERSION, validateScene } from '../src/scene.js';

describe('validateScene', () => {
  let registry: ComponentRegistry;
  beforeEach(() => {
    registry = new ComponentRegistry();
    registerBuiltins(registry);
  });

  const good = {
    version: SCENE_VERSION,
    name: 'Scene_01',
    entities: [
      { id: 1, name: 'Root', components: {} },
      {
        id: 2, name: 'Chair', parent: 1,
        components: { Mesh: { asset: 'a.glb', castShadow: true } },
      },
    ],
  };

  it('accepts a valid scene', () => {
    expect(validateScene(good, registry)).toEqual([]);
  });

  it('rejects a non-object file', () => {
    expect(validateScene(null, registry)).toEqual([
      { path: 'scene', message: 'expected an object' },
    ]);
  });

  it('rejects an unsupported version', () => {
    expect(validateScene({ ...good, version: 99 }, registry)).toContainEqual({
      path: 'scene.version', message: `expected version ${SCENE_VERSION}`,
    });
  });

  it('rejects a missing name', () => {
    const { name: _name, ...rest } = good;
    expect(validateScene(rest, registry)).toContainEqual({
      path: 'scene.name', message: 'expected a string',
    });
  });

  it('rejects entities that are not an array', () => {
    expect(validateScene({ ...good, entities: {} }, registry)).toContainEqual({
      path: 'scene.entities', message: 'expected an array',
    });
  });

  it('rejects a non-integer id', () => {
    const file = { ...good, entities: [{ id: 'x', name: 'A', components: {} }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].id', message: 'expected a positive integer',
    });
  });

  it('rejects a duplicate id', () => {
    const file = {
      ...good,
      entities: [
        { id: 1, name: 'A', components: {} },
        { id: 1, name: 'B', components: {} },
      ],
    };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[1].id', message: 'duplicate entity id 1',
    });
  });

  it('rejects a parent that does not exist', () => {
    const file = { ...good, entities: [{ id: 1, name: 'A', parent: 42, components: {} }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].parent', message: 'unknown parent entity 42',
    });
  });

  it('rejects an unknown component type', () => {
    const file = { ...good, entities: [{ id: 1, name: 'A', components: { Nope: {} } }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].components.Nope', message: 'unknown component type',
    });
  });

  it('reports component field errors with the entity path', () => {
    const file = {
      ...good,
      entities: [{ id: 1, name: 'A', components: { Mesh: { asset: 'a.glb', castShadow: 'yes' } } }],
    };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].components.Mesh.castShadow',
      message: 'expected a boolean',
    });
  });

  // --- Additional untrusted-input cases ---

  it('rejects a null entity as "expected an object"', () => {
    const file = { ...good, entities: [null] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0]', message: 'expected an object',
    });
  });

  it('rejects an array entity as "expected an object"', () => {
    const file = { ...good, entities: [[1, 2, 3]] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0]', message: 'expected an object',
    });
  });

  it('rejects a components value that is an array', () => {
    const file = { ...good, entities: [{ id: 1, name: 'A', components: [] }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].components', message: 'expected an object',
    });
  });

  it('accepts a scene with an empty entities array', () => {
    const file = { ...good, entities: [] };
    expect(validateScene(file, registry)).toEqual([]);
  });

  it('rejects an explicit null parent as an unknown parent entity', () => {
    const file = { ...good, entities: [{ id: 1, name: 'A', parent: null, components: {} }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].parent', message: 'unknown parent entity null',
    });
  });

  it('accepts a forward-referenced parent declared later in the entities array', () => {
    const file = {
      ...good,
      entities: [
        { id: 2, name: 'Child', parent: 1, components: {} },
        { id: 1, name: 'Parent', components: {} },
      ],
    };
    expect(validateScene(file, registry)).toEqual([]);
  });

  it('rejects a non-object component data as a whole-component error, not a doubled path', () => {
    const file = { ...good, entities: [{ id: 1, name: 'A', components: { Mesh: 'not-an-object' } }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].components.Mesh', message: 'expected an object',
    });
  });

  it('rejects a numeric component data as a whole-component error', () => {
    const file = { ...good, entities: [{ id: 1, name: 'A', components: { Mesh: 42 } }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].components.Mesh', message: 'expected an object',
    });
  });

  // --- Parent cycle detection ---

  it('rejects a two-entity parent cycle, one error per entity on the cycle', () => {
    const file = {
      ...good,
      entities: [
        { id: 1, name: 'A', parent: 2, components: {} },
        { id: 2, name: 'B', parent: 1, components: {} },
      ],
    };
    const result = validateScene(file, registry);
    expect(result).toContainEqual({
      path: 'scene.entities[0].parent', message: 'parent cycle detected',
    });
    expect(result).toContainEqual({
      path: 'scene.entities[1].parent', message: 'parent cycle detected',
    });
  });

  it('rejects a self-parented entity as a cycle', () => {
    const file = { ...good, entities: [{ id: 1, name: 'A', parent: 1, components: {} }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].parent', message: 'parent cycle detected',
    });
  });

  it('rejects a three-entity parent cycle, one error per entity on the cycle', () => {
    const file = {
      ...good,
      entities: [
        { id: 1, name: 'A', parent: 2, components: {} },
        { id: 2, name: 'B', parent: 3, components: {} },
        { id: 3, name: 'C', parent: 1, components: {} },
      ],
    };
    const result = validateScene(file, registry);
    expect(result).toContainEqual({
      path: 'scene.entities[0].parent', message: 'parent cycle detected',
    });
    expect(result).toContainEqual({
      path: 'scene.entities[1].parent', message: 'parent cycle detected',
    });
    expect(result).toContainEqual({
      path: 'scene.entities[2].parent', message: 'parent cycle detected',
    });
  });

  it('accepts a deep but acyclic parent chain (four levels) with no cycle error', () => {
    const file = {
      ...good,
      entities: [
        { id: 1, name: 'Root', components: {} },
        { id: 2, name: 'Child', parent: 1, components: {} },
        { id: 3, name: 'Grandchild', parent: 2, components: {} },
        { id: 4, name: 'GreatGrandchild', parent: 3, components: {} },
      ],
    };
    expect(validateScene(file, registry)).toEqual([]);
  });
});
