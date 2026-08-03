import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/registry.js';

describe('ComponentRegistry.validate', () => {
  let registry: ComponentRegistry;
  beforeEach(() => {
    registry = new ComponentRegistry();
    registry.define('Sample', {
      num: { type: 'number', default: 0 },
      count: { type: 'int', default: 0 },
      flag: { type: 'bool', default: false },
      label: { type: 'string', default: '' },
      position: { type: 'vec3', default: [0, 0, 0] },
      rotation: { type: 'euler', default: [0, 0, 0] },
      tint: { type: 'color', default: '#ffffff' },
      kind: { type: 'enum', default: 'a', options: ['a', 'b'] },
      asset: { type: 'asset', default: null, accept: '.glb' },
      target: { type: 'entity', default: null },
    });
  });

  const valid = {
    num: 1.5, count: 3, flag: true, label: 'hi',
    position: [1, 2, 3], rotation: [0, 0, 0], tint: '#ff0000',
    kind: 'b', asset: 'assets/PRP_Chair_01.glb', target: 7,
  };

  it('accepts fully valid data', () => {
    expect(registry.validate('Sample', valid)).toEqual([]);
  });

  it('accepts null for asset and entity fields', () => {
    expect(registry.validate('Sample', { ...valid, asset: null, target: null })).toEqual([]);
  });

  it('rejects an unknown component type', () => {
    expect(registry.validate('Nope', {})).toEqual([
      { path: 'Nope', message: 'unknown component type' },
    ]);
  });

  it('rejects non-object data', () => {
    expect(registry.validate('Sample', 42)).toEqual([
      { path: 'Sample', message: 'expected an object' },
    ]);
  });

  it('reports a missing field', () => {
    const { num: _num, ...rest } = valid;
    expect(registry.validate('Sample', rest)).toContainEqual({
      path: 'Sample.num', message: 'missing field',
    });
  });

  it('reports an unknown field', () => {
    expect(registry.validate('Sample', { ...valid, extra: 1 })).toContainEqual({
      path: 'Sample.extra', message: 'unknown field',
    });
  });

  it('rejects a non-finite number', () => {
    expect(registry.validate('Sample', { ...valid, num: Number.NaN })).toContainEqual({
      path: 'Sample.num', message: 'expected a finite number',
    });
  });

  it('rejects a non-integer int', () => {
    expect(registry.validate('Sample', { ...valid, count: 1.5 })).toContainEqual({
      path: 'Sample.count', message: 'expected an integer',
    });
  });

  it('rejects a wrong-typed boolean', () => {
    expect(registry.validate('Sample', { ...valid, flag: 'yes' })).toContainEqual({
      path: 'Sample.flag', message: 'expected a boolean',
    });
  });

  it('rejects a vec3 of the wrong length', () => {
    expect(registry.validate('Sample', { ...valid, position: [1, 2] })).toContainEqual({
      path: 'Sample.position', message: 'expected an array of 3 finite numbers',
    });
  });

  it('rejects a malformed color', () => {
    expect(registry.validate('Sample', { ...valid, tint: 'red' })).toContainEqual({
      path: 'Sample.tint', message: 'expected a hex color such as #ff0000',
    });
  });

  it('rejects an enum value outside its options', () => {
    expect(registry.validate('Sample', { ...valid, kind: 'z' })).toContainEqual({
      path: 'Sample.kind', message: 'expected one of: a, b',
    });
  });

  it('rejects a non-integer entity reference', () => {
    expect(registry.validate('Sample', { ...valid, target: 'x' })).toContainEqual({
      path: 'Sample.target', message: 'expected an entity id or null',
    });
  });

  it('collects several errors at once', () => {
    expect(registry.validate('Sample', { ...valid, num: 'x', flag: 'y' })).toHaveLength(2);
  });

  it('reports constructor field as unknown field', () => {
    expect(registry.validate('Sample', { ...valid, constructor: 42 })).toContainEqual({
      path: 'Sample.constructor', message: 'unknown field',
    });
  });

  it('reports toString field as unknown field', () => {
    expect(registry.validate('Sample', { ...valid, toString: 42 })).toContainEqual({
      path: 'Sample.toString', message: 'unknown field',
    });
  });

  it('rejects a non-string string field', () => {
    expect(registry.validate('Sample', { ...valid, label: 42 })).toContainEqual({
      path: 'Sample.label', message: 'expected a string',
    });
  });

  it('rejects a malformed euler', () => {
    expect(registry.validate('Sample', { ...valid, rotation: [1, 2, 'x'] })).toContainEqual({
      path: 'Sample.rotation', message: 'expected an array of 3 finite numbers',
    });
  });

  it('rejects a non-string asset', () => {
    expect(registry.validate('Sample', { ...valid, asset: 42 })).toContainEqual({
      path: 'Sample.asset', message: 'expected an asset path or null',
    });
  });

  describe('prototype field collisions', () => {
    let registryWithProtoField: ComponentRegistry;
    beforeEach(() => {
      registryWithProtoField = new ComponentRegistry();
      registryWithProtoField.define('WithToString', {
        toString: { type: 'string' as const, default: 'test' },
        value: { type: 'number' as const, default: 0 },
      });
    });

    it('reports missing toString field when it is omitted', () => {
      expect(registryWithProtoField.validate('WithToString', { value: 5 })).toContainEqual({
        path: 'WithToString.toString', message: 'missing field',
      });
    });
  });
});
