import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, prune, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import type { AssetCategory, AssetMetadata, Vec3 } from '../types.js';
import { TEXTURE_LIMITS } from './naming.js';

export interface OptimizeRequest {
  source: string;
  target: string;
  category: AssetCategory;
}

/**
 * The seam between the pipeline and gltf-transform.
 * Everything downstream depends on this interface, never on the library, so the
 * pipeline is testable without touching a real .glb.
 */
export interface AssetOptimizer {
  run(request: OptimizeRequest): Promise<AssetMetadata>;
}

/** Reads the facts the editor needs without re-parsing the file afterwards. */
export function readMetadata(document: Document): AssetMetadata {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let sawVertex = false;

  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const [tx, ty, tz] = node.getWorldTranslation();

    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;

      // Only triangle modes contribute triangles; mode 4 is TRIANGLES, which is
      // what the .glb export convention produces.
      const count = indices ? indices.getCount() : position.getCount();
      if (primitive.getMode() === 4) triangles += Math.floor(count / 3);

      const vertex = [0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, vertex);
        const world: Vec3 = [
          (vertex[0] ?? 0) + tx, (vertex[1] ?? 0) + ty, (vertex[2] ?? 0) + tz,
        ];
        for (let axis = 0; axis < 3; axis++) {
          const value = world[axis] as number;
          if (value < (min[axis] as number)) min[axis] = value;
          if (value > (max[axis] as number)) max[axis] = value;
        }
        sawVertex = true;
      }
    }
  }

  const animations = document.getRoot().listAnimations()
    .map((a) => a.getName())
    .sort();

  // A document with no geometry has no meaningful box; Infinity would poison
  // every consumer that tries to frame the asset in a viewport.
  if (!sawVertex) {
    return { bounds: { min: [0, 0, 0], max: [0, 0, 0] }, animations, triangles };
  }
  return { bounds: { min, max }, animations, triangles };
}

/**
 * The real optimizer: Draco compression, per-category texture ceiling, and a
 * purge of everything the runtime will never read.
 *
 * Not unit tested beyond the happy path — it is an adapter over a library, and
 * the library's own behaviour is not ours to re-test.
 */
export async function createGltfTransformOptimizer(): Promise<AssetOptimizer> {
  // Draco's encoder initializes asynchronously; done once, at server boot,
  // rather than per asset.
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  return {
    async run({ source, target, category }: OptimizeRequest): Promise<AssetMetadata> {
      let document: Document;
      try {
        document = await io.read(source);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`failed to read asset "${source}": ${message}`, { cause });
      }

      const limit = TEXTURE_LIMITS[category];
      await document.transform(
        // Order matters: prune and dedup first so compression never spends time
        // on data that is about to be deleted.
        prune(),
        dedup(),
        textureCompress({ encoder: sharp, resize: [limit, limit] }),
        draco(),
      );

      // Metadata is read after the transform, so the numbers describe what the
      // runtime will actually load, not what the artist exported.
      const metadata = readMetadata(document);

      await mkdir(dirname(target), { recursive: true });
      await io.write(target, document);
      return metadata;
    },
  };
}
