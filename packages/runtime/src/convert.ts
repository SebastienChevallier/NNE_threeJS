import {
  AmbientLight, Color, DirectionalLight, type Light, Object3D, PointLight, SpotLight,
} from 'three';
import type { LightData, TransformData } from './types.js';

/**
 * Writes a Transform component onto an Object3D, in place.
 * Called once per entity per frame, so it must not allocate.
 */
export function applyTransform(object: Object3D, data: TransformData): void {
  object.position.set(data.position[0], data.position[1], data.position[2]);
  object.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2], 'XYZ');
  object.scale.set(data.scale[0], data.scale[1], data.scale[2]);
}

export function createLight(data: LightData): Light {
  const color = new Color(data.color);
  switch (data.type) {
    case 'directional': return new DirectionalLight(color, data.intensity);
    case 'point':       return new PointLight(color, data.intensity);
    case 'ambient':     return new AmbientLight(color, data.intensity);
    case 'spot':        return new SpotLight(color, data.intensity);
  }
}

/**
 * Updates a light in place. Returns false when the component's light type no
 * longer matches the object's class, meaning the caller must recreate it —
 * three.js light types are separate classes, not a mutable property.
 */
export function applyLight(light: Light, data: LightData): boolean {
  if (!matchesType(light, data.type)) return false;
  light.color.set(data.color);
  light.intensity = data.intensity;
  return true;
}

function matchesType(light: Light, type: LightData['type']): boolean {
  switch (type) {
    case 'directional': return light instanceof DirectionalLight;
    case 'point':       return light instanceof PointLight;
    case 'ambient':     return light instanceof AmbientLight;
    case 'spot':        return light instanceof SpotLight;
  }
}
