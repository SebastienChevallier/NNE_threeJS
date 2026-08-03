import { describe, expect, it } from 'vitest';
import {
  CAMERA, ComponentRegistry, LIGHT, MESH, TRANSFORM, registerBuiltins, type FieldSpec,
} from '@nne/core';
import { addableComponents, coerceFieldValue, describeComponent } from '../src/model/fields.js';

function registry(): ComponentRegistry {
  const r = new ComponentRegistry();
  registerBuiltins(r);
  return r;
}

describe('describeComponent', () => {
  it('describes every field of a component, in schema order', () => {
    const fields = describeComponent(registry(), TRANSFORM, {
      position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1],
    });
    expect(fields.map((f) => f.name)).toEqual(['position', 'rotation', 'scale']);
    expect(fields[0]).toMatchObject({ name: 'position', type: 'vec3', value: [1, 2, 3] });
  });

  it('carries the enum options through, so the control can render them', () => {
    const fields = describeComponent(registry(), LIGHT, {
      type: 'point', color: '#ffffff', intensity: 1,
    });
    expect(fields[0]).toMatchObject({
      type: 'enum',
      options: ['directional', 'point', 'ambient', 'spot'],
    });
  });

  it('carries the asset filter through', () => {
    const fields = describeComponent(registry(), MESH, { asset: null, castShadow: true });
    expect(fields[0]).toMatchObject({ type: 'asset', accept: '.glb' });
  });

  it('falls back to the schema default when the data is missing a field', () => {
    // A scene written before a field was added to the schema still opens.
    const fields = describeComponent(registry(), CAMERA, { fov: 50 });
    expect(fields.find((f) => f.name === 'near')?.value).toBe(0.1);
  });

  it('does not mistake an inherited property for a value', () => {
    // `'toString' in data` would be true for every object; the value shown must
    // come from the data itself or from the schema default, never a prototype.
    const fields = describeComponent(registry(), CAMERA, {});
    expect(fields.find((f) => f.name === 'fov')?.value).toBe(60);
  });

  it('returns an empty list for an unknown component', () => {
    expect(describeComponent(registry(), 'Nope', {})).toEqual([]);
  });
});

describe('coerceFieldValue', () => {
  const spec = (type: string, extra: object = {}): FieldSpec =>
    ({ type, default: null, ...extra }) as FieldSpec;

  it('parses a number from a text input', () => {
    expect(coerceFieldValue(spec('number'), '1.5')).toBe(1.5);
  });

  it('rejects an empty number input rather than writing zero', () => {
    // Typing over a value momentarily empties the input; writing 0 there would
    // silently destroy the value the user is in the middle of replacing.
    expect(coerceFieldValue(spec('number'), '')).toBeUndefined();
  });

  it('rejects a number input that is not a number', () => {
    expect(coerceFieldValue(spec('number'), 'abc')).toBeUndefined();
  });

  it('rejects a non-finite number', () => {
    expect(coerceFieldValue(spec('number'), 'Infinity')).toBeUndefined();
    expect(coerceFieldValue(spec('number'), Number.NaN)).toBeUndefined();
  });

  it('truncates an int', () => {
    expect(coerceFieldValue(spec('int'), '3.7')).toBe(3);
  });

  it('passes a bool through', () => {
    expect(coerceFieldValue(spec('bool'), true)).toBe(true);
    expect(coerceFieldValue(spec('bool'), 'true')).toBeUndefined();
  });

  it('passes a string through, empty included', () => {
    expect(coerceFieldValue(spec('string'), '')).toBe('');
  });

  it('builds a vec3 from three numbers', () => {
    expect(coerceFieldValue(spec('vec3'), ['1', '2', '3'])).toEqual([1, 2, 3]);
  });

  it('rejects a vec3 with a non-numeric component', () => {
    expect(coerceFieldValue(spec('vec3'), ['1', '', '3'])).toBeUndefined();
  });

  it('rejects a vec3 of the wrong length', () => {
    expect(coerceFieldValue(spec('vec3'), ['1', '2'])).toBeUndefined();
  });

  it('treats euler like vec3, in radians', () => {
    expect(coerceFieldValue(spec('euler'), ['0', '1.57', '0'])).toEqual([0, 1.57, 0]);
  });

  it('accepts an enum value that is in the options', () => {
    expect(coerceFieldValue(spec('enum', { options: ['a', 'b'] }), 'b')).toBe('b');
  });

  it('rejects an enum value that is not', () => {
    expect(coerceFieldValue(spec('enum', { options: ['a', 'b'] }), 'c')).toBeUndefined();
  });

  it('accepts a hex colour', () => {
    expect(coerceFieldValue(spec('color'), '#ff0000')).toBe('#ff0000');
  });

  it('rejects a malformed colour', () => {
    expect(coerceFieldValue(spec('color'), 'red')).toBeUndefined();
    expect(coerceFieldValue(spec('color'), '#fff')).toBeUndefined();
  });

  it('accepts null for an asset, which means "no asset"', () => {
    expect(coerceFieldValue(spec('asset'), null)).toBeNull();
  });

  it('accepts an asset path', () => {
    expect(coerceFieldValue(spec('asset'), 'props/PRP_A.glb')).toBe('props/PRP_A.glb');
  });

  it('rejects an empty asset path, which is neither a path nor "none"', () => {
    expect(coerceFieldValue(spec('asset'), '')).toBeUndefined();
  });

  it('accepts an entity id, and null for none', () => {
    expect(coerceFieldValue(spec('entity'), '4')).toBe(4);
    expect(coerceFieldValue(spec('entity'), null)).toBeNull();
  });

  it('produces a value the registry then accepts', () => {
    // The point of coercion is that what comes out is writable. If the registry
    // rejects it, the coercion was theatre.
    const r = registry();
    const coerced = coerceFieldValue(
      r.get(LIGHT)?.['intensity'] as FieldSpec,
      '2.5',
    );
    expect(r.validate(LIGHT, { type: 'point', color: '#ffffff', intensity: coerced })).toEqual([]);
  });
});

describe('addableComponents', () => {
  it('lists the registered components the entity does not have', () => {
    expect(addableComponents(registry(), [TRANSFORM])).toEqual([CAMERA, LIGHT, MESH]);
  });

  it('returns an empty list when the entity has them all', () => {
    expect(addableComponents(registry(), [TRANSFORM, MESH, CAMERA, LIGHT])).toEqual([]);
  });
});
