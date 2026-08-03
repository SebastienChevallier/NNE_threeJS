import type { ComponentRegistry } from './registry.js';

export const TRANSFORM = 'Transform';
export const MESH = 'Mesh';
export const CAMERA = 'Camera';
export const LIGHT = 'Light';

export const LIGHT_TYPES = ['directional', 'point', 'ambient', 'spot'] as const;

/** Defines the four components every project starts with. */
export function registerBuiltins(registry: ComponentRegistry): void {
  registry.define(TRANSFORM, {
    position: { type: 'vec3', default: [0, 0, 0] },
    rotation: { type: 'euler', default: [0, 0, 0] },
    scale: { type: 'vec3', default: [1, 1, 1] },
  });

  registry.define(MESH, {
    asset: { type: 'asset', default: null, accept: '.glb' },
    castShadow: { type: 'bool', default: true },
  });

  registry.define(CAMERA, {
    fov: { type: 'number', default: 60 },
    near: { type: 'number', default: 0.1 },
    far: { type: 'number', default: 1000 },
    active: { type: 'bool', default: true },
  });

  registry.define(LIGHT, {
    type: { type: 'enum', default: 'directional', options: LIGHT_TYPES },
    color: { type: 'color', default: '#ffffff' },
    intensity: { type: 'number', default: 1 },
  });
}
