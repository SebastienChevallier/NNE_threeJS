import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/registry.js';

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry;
  beforeEach(() => { registry = new ComponentRegistry(); });

  it('defines and reads back a schema', () => {
    registry.define('Mesh', { asset: { type: 'asset', default: null, accept: '.glb' } });
    expect(registry.get('Mesh')).toEqual({
      asset: { type: 'asset', default: null, accept: '.glb' },
    });
  });

  it('reports presence', () => {
    expect(registry.has('Mesh')).toBe(false);
    registry.define('Mesh', {});
    expect(registry.has('Mesh')).toBe(true);
  });

  it('lists registered types sorted', () => {
    registry.define('Mesh', {});
    registry.define('Camera', {});
    expect(registry.list()).toEqual(['Camera', 'Mesh']);
  });

  it('refuses a duplicate definition', () => {
    registry.define('Mesh', {});
    expect(() => registry.define('Mesh', {})).toThrow(/already defined/);
  });

  it('refuses an unknown field type', () => {
    expect(() =>
      registry.define('Bad', { x: { type: 'quaternion' as never, default: null } }),
    ).toThrow(/unknown field type "quaternion"/);
  });

  it('refuses an enum field without options', () => {
    expect(() =>
      registry.define('Bad', { kind: { type: 'enum', default: 'a' } }),
    ).toThrow(/enum field "kind" needs options/);
  });

  it('refuses an enum whose default is not among its options', () => {
    expect(() =>
      registry.define('Bad', { kind: { type: 'enum', default: 'z', options: ['a', 'b'] } }),
    ).toThrow(/default "z" is not among options/);
  });

  it('builds default data from the schema', () => {
    registry.define('Transform', {
      position: { type: 'vec3', default: [0, 0, 0] },
      scale: { type: 'vec3', default: [1, 1, 1] },
    });
    expect(registry.createDefault('Transform')).toEqual({
      position: [0, 0, 0],
      scale: [1, 1, 1],
    });
  });

  it('returns a fresh copy of defaults each time', () => {
    registry.define('Transform', { position: { type: 'vec3', default: [0, 0, 0] } });
    const first = registry.createDefault('Transform') as { position: number[] };
    first.position[0] = 99;
    expect(registry.createDefault('Transform')).toEqual({ position: [0, 0, 0] });
  });

  it('throws when building defaults for an unknown type', () => {
    expect(() => registry.createDefault('Nope')).toThrow(/unknown component type "Nope"/);
  });

  it('freezes the schema to prevent mutation', () => {
    registry.define('Mesh', { asset: { type: 'asset', default: null, accept: '.glb' } });
    const schema = registry.get('Mesh');
    expect(Object.isFrozen(schema)).toBe(true);
  });

  it('prevents mutation of field default values via get()', () => {
    registry.define('Mesh', { asset: { type: 'asset', default: null, accept: '.glb' } });
    const schema = registry.get('Mesh')! as Record<string, any>;
    expect(() => {
      // In strict mode (ESM), this should throw when trying to modify a frozen object
      schema.asset.default = 'mutated';
    }).toThrow();
    // Verify the registry's createDefault is unaffected
    expect(registry.createDefault('Mesh')).toEqual({ asset: null });
  });

  it('prevents mutation of enum options via get()', () => {
    registry.define('Bad', { kind: { type: 'enum', default: 'a', options: ['a', 'b'] } });
    const schema = registry.get('Bad')! as Record<string, any>;
    expect(() => {
      schema.kind.options.push('c');
    }).toThrow();
    // Verify the registry is unaffected
    const schema2 = registry.get('Bad')! as Record<string, any>;
    expect(schema2.kind.options).toEqual(['a', 'b']);
  });

  it('refuses an enum field with empty options array', () => {
    expect(() =>
      registry.define('Bad', { kind: { type: 'enum', default: 'a', options: [] } }),
    ).toThrow(/enum field "kind" needs options/);
  });

  it('preserves schema field order', () => {
    registry.define('Ordered', {
      zulu: { type: 'string', default: 'z' },
      alpha: { type: 'string', default: 'a' },
      mike: { type: 'string', default: 'm' },
    });
    const schema = registry.get('Ordered');
    expect(Object.keys(schema!)).toEqual(['zulu', 'alpha', 'mike']);
    const defaults = registry.createDefault('Ordered');
    expect(Object.keys(defaults)).toEqual(['zulu', 'alpha', 'mike']);
  });
});
