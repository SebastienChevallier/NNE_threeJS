import { describe, expect, it } from 'vitest';
import { AmbientLight, DirectionalLight, Object3D, PointLight, SpotLight } from 'three';
import { applyLight, applyTransform, createLight } from '../src/convert.js';
import type { LightData, TransformData } from '../src/types.js';

const transform = (over: Partial<TransformData> = {}): TransformData => ({
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], ...over,
});

describe('applyTransform', () => {
  it('writes position, rotation and scale', () => {
    const object = new Object3D();
    applyTransform(object, transform({ position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [2, 2, 2] }));
    expect(object.position.toArray()).toEqual([1, 2, 3]);
    expect([object.rotation.x, object.rotation.y, object.rotation.z]).toEqual([0.1, 0.2, 0.3]);
    expect(object.scale.toArray()).toEqual([2, 2, 2]);
  });

  it('uses XYZ euler order', () => {
    const object = new Object3D();
    applyTransform(object, transform({ rotation: [1, 2, 3] }));
    expect(object.rotation.order).toBe('XYZ');
  });

  it('overwrites a previous transform rather than accumulating', () => {
    const object = new Object3D();
    applyTransform(object, transform({ position: [5, 5, 5] }));
    applyTransform(object, transform({ position: [1, 1, 1] }));
    expect(object.position.toArray()).toEqual([1, 1, 1]);
  });

  it('does not allocate a new object', () => {
    const object = new Object3D();
    const position = object.position;
    applyTransform(object, transform({ position: [1, 2, 3] }));
    expect(object.position).toBe(position);
  });
});

describe('createLight', () => {
  const light = (over: Partial<LightData> = {}): LightData => ({
    type: 'directional', color: '#ffffff', intensity: 1, ...over,
  });

  it('creates each light type', () => {
    expect(createLight(light({ type: 'directional' }))).toBeInstanceOf(DirectionalLight);
    expect(createLight(light({ type: 'point' }))).toBeInstanceOf(PointLight);
    expect(createLight(light({ type: 'ambient' }))).toBeInstanceOf(AmbientLight);
    expect(createLight(light({ type: 'spot' }))).toBeInstanceOf(SpotLight);
  });

  it('applies colour and intensity', () => {
    const created = createLight(light({ color: '#ff0000', intensity: 2.5 }));
    expect(created.color.getHexString()).toBe('ff0000');
    expect(created.intensity).toBe(2.5);
  });
});

describe('applyLight', () => {
  const light = (over: Partial<LightData> = {}): LightData => ({
    type: 'directional', color: '#ffffff', intensity: 1, ...over,
  });

  it('updates colour and intensity in place and reports success', () => {
    const existing = createLight(light());
    expect(applyLight(existing, light({ color: '#00ff00', intensity: 3 }))).toBe(true);
    expect(existing.color.getHexString()).toBe('00ff00');
    expect(existing.intensity).toBe(3);
  });

  it('reports failure when the light type changed', () => {
    const existing = createLight(light({ type: 'directional' }));
    expect(applyLight(existing, light({ type: 'point' }))).toBe(false);
  });
});
