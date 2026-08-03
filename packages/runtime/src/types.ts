import type { EntityId } from '@nne/core';

/** A position or scale triple, in metres. 1 unit = 1 metre. */
export type Vec3 = [number, number, number];

/** Rotation triple in RADIANS, applied in XYZ order. */
export type Euler = [number, number, number];

export interface TransformData {
  position: Vec3;
  rotation: Euler;
  scale: Vec3;
}

export interface MeshData {
  asset: string | null;
  castShadow: boolean;
}

export interface CameraData {
  fov: number;
  near: number;
  far: number;
  active: boolean;
}

export interface LightData {
  type: 'directional' | 'point' | 'ambient' | 'spot';
  color: string;
  intensity: number;
}

/** Identifies which entity an Object3D mirrors. */
export interface EntityUserData {
  entity: EntityId;
}
