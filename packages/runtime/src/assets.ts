import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Injectable loader, so the cache is testable without network or GPU. */
export interface GltfSource {
  load(url: string): Promise<Object3D>;
}

/**
 * Loads each .glb once and hands out a deep clone per request, so several
 * entities can share an asset without sharing its transform.
 */
export class AssetCache {
  private readonly pending = new Map<string, Promise<Object3D>>();
  private readonly loaded = new Map<string, Object3D>();

  constructor(private readonly source: GltfSource) {}

  async get(url: string): Promise<Object3D> {
    const cached = this.loaded.get(url);
    if (cached) return cached.clone(true);

    let inFlight = this.pending.get(url);
    if (!inFlight) {
      inFlight = this.source
        .load(url)
        .catch((cause: unknown) => {
          // Drop the entry so a later call can retry rather than replaying the failure.
          this.pending.delete(url);
          const message = cause instanceof Error ? cause.message : String(cause);
          throw new Error(`failed to load asset "${url}": ${message}`, { cause });
        });
      this.pending.set(url, inFlight);
    }

    const root = await inFlight;
    this.loaded.set(url, root);
    this.pending.delete(url);
    return root.clone(true);
  }

  size(): number {
    return this.loaded.size;
  }

  clear(): void {
    this.loaded.clear();
    this.pending.clear();
  }
}

/** Browser-side adapter. Not unit tested: it needs a real network and DOM. */
export function createGltfSource(): GltfSource {
  const loader = new GLTFLoader();
  return {
    async load(url: string): Promise<Object3D> {
      const gltf = await loader.loadAsync(url);
      return gltf.scene;
    },
  };
}
