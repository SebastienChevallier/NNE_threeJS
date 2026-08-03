import type { Object3D, PerspectiveCamera, Scene } from 'three';
import type { ApiClient } from './api/client.js';

type Vec3 = [number, number, number];

/** An asset's bounding box, as the server measured it at import. */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface Framing {
  position: Vec3;
  target: Vec3;
}

/** Field of view the thumbnail camera uses, in degrees. */
const THUMBNAIL_FOV = 35;
/** Breathing room around the object, as a multiple of its radius. */
const MARGIN = 1.6;
/** Used when the box is degenerate, so the camera is never inside the object. */
const MIN_SIZE = 1;

/**
 * Where to put the camera to frame an asset.
 *
 * Aims at the *centre* of the bounding box rather than the origin: the project
 * convention puts an asset's origin at its base, on the floor, so aiming at the
 * origin would frame the feet of every character.
 *
 * Pure maths, so the framing is testable without a GPU — which is the whole
 * reason this is a separate function from the render.
 */
export function framingFor(bounds: Bounds): Framing {
  const target: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];

  const size = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
    // An asset with no geometry reports a zero box. Without a floor here the
    // distance would be 0 — camera inside the object — and every downstream
    // division would produce NaN, silently blanking the thumbnail.
    MIN_SIZE,
  );

  const halfFov = (THUMBNAIL_FOV * Math.PI) / 180 / 2;
  const distance = (size / 2 / Math.tan(halfFov)) * MARGIN;

  // A three-quarter view: straight-on, a box reads as a rectangle. The vector
  // is normalized so `distance` means what it says.
  const direction: Vec3 = [1, 0.7, 1];
  const length = Math.hypot(...direction);

  return {
    target,
    position: [
      target[0] + (direction[0] / length) * distance,
      target[1] + (direction[1] / length) * distance,
      target[2] + (direction[2] / length) * distance,
    ],
  };
}

/** The GPU-bound half, behind a seam. Renders one frame and returns a PNG. */
export interface ThumbnailRenderer {
  render(scene: Scene, camera: PerspectiveCamera): Promise<Uint8Array<ArrayBuffer>>;
  dispose(): void;
}

export interface ThumbnailJob {
  path: string;
  object: Object3D;
  bounds: Bounds;
}

export interface ThumbnailOptions {
  client: ApiClient;
  renderer: ThumbnailRenderer;
  makeScene: (object: Object3D) => Scene;
  makeCamera: (framing: Framing) => PerspectiveCamera;
}

/**
 * Renders a thumbnail for each asset and uploads it.
 *
 * This is the piece plan 3 deferred here on purpose: node has no GPU, the
 * editor does, and it already has the mesh loaded. The server only stores and
 * serves what this produces.
 *
 * One failure does not stop the run: a single unrenderable asset must not leave
 * the rest of the library without thumbnails.
 */
export async function renderThumbnails(
  jobs: readonly ThumbnailJob[],
  options: ThumbnailOptions,
  onError?: (path: string, message: string) => void,
): Promise<number> {
  let uploaded = 0;
  for (const job of jobs) {
    try {
      const framing = framingFor(job.bounds);
      const png = await options.renderer.render(
        options.makeScene(job.object),
        options.makeCamera(framing),
      );
      await options.client.putThumbnail(job.path, png);
      uploaded++;
    } catch (cause) {
      onError?.(job.path, cause instanceof Error ? cause.message : String(cause));
    }
  }
  return uploaded;
}
