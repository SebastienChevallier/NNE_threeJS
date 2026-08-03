import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/registry.js';
import { CAMERA, LIGHT, MESH, TRANSFORM, registerBuiltins } from '../src/builtins.js';

describe('builtin components', () => {
  let registry: ComponentRegistry;
  beforeEach(() => {
    registry = new ComponentRegistry();
    registerBuiltins(registry);
  });

  it('registers exactly the four builtin components', () => {
    expect(registry.list()).toEqual(['Camera', 'Light', 'Mesh', 'Transform']);
  });

  it('exposes the component names as constants', () => {
    expect([TRANSFORM, MESH, CAMERA, LIGHT]).toEqual(['Transform', 'Mesh', 'Camera', 'Light']);
  });

  it('defaults Transform to identity', () => {
    expect(registry.createDefault(TRANSFORM)).toEqual({
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    });
  });

  it('defaults Mesh to no asset', () => {
    expect(registry.createDefault(MESH)).toEqual({ asset: null, castShadow: true });
  });

  it('defaults Camera to a 60 degree perspective', () => {
    expect(registry.createDefault(CAMERA)).toEqual({
      fov: 60, near: 0.1, far: 1000, active: true,
    });
  });

  it('defaults Light to a white directional light', () => {
    expect(registry.createDefault(LIGHT)).toEqual({
      type: 'directional', color: '#ffffff', intensity: 1,
    });
  });

  it('accepts the four light types', () => {
    for (const type of ['directional', 'point', 'ambient', 'spot']) {
      const data = { ...registry.createDefault(LIGHT), type };
      expect(registry.validate(LIGHT, data)).toEqual([]);
    }
  });

  it('rejects an unknown light type', () => {
    const data = { ...registry.createDefault(LIGHT), type: 'laser' };
    expect(registry.validate(LIGHT, data)).toContainEqual({
      path: 'Light.type',
      message: 'expected one of: directional, point, ambient, spot',
    });
  });

  it('validates every builtin default against its own schema', () => {
    for (const type of registry.list()) {
      expect(registry.validate(type, registry.createDefault(type))).toEqual([]);
    }
  });

  it('restricts Mesh assets to .glb', () => {
    expect(registry.get(MESH)?.asset?.accept).toBe('.glb');
  });
});
