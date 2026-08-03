import type { SceneFile } from '@nne/core';
import type { AssetSummary } from '../types.js';

/** Mirrors editor-server's ProjectFile, over the wire. */
export interface ProjectSummary {
  name: string;
  version: number;
  startScene: string | null;
}

/**
 * The disk events the server pushes.
 *
 * Redeclared rather than imported: `editor` does not depend on `editor-server`,
 * it talks to it over HTTP. The wire format is the contract, not a shared type.
 */
export type ProjectEvent =
  | { type: 'asset-changed'; path: string }
  | { type: 'asset-removed'; path: string }
  | { type: 'asset-failed'; path: string; message: string }
  | { type: 'scene-changed'; name: string };

export interface BuildSummary {
  scenes: string[];
  assets: string[];
}

export interface ApiClient {
  getProject(): Promise<{ project: ProjectSummary; scenes: string[] }>;
  getScene(name: string): Promise<SceneFile>;
  putScene(name: string, scene: SceneFile): Promise<void>;
  getAssets(): Promise<AssetSummary[]>;
  scanAssets(): Promise<AssetSummary[]>;
  /**
   * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: a body cannot be
   * backed by a SharedArrayBuffer, and a rendered thumbnail never is. Saying so
   * in the signature is more honest than casting at the call site.
   */
  putThumbnail(path: string, png: Uint8Array<ArrayBuffer>): Promise<void>;
  build(outDir: string): Promise<BuildSummary>;
}

export interface ApiClientOptions {
  /** Injectable so every call is testable without a server. */
  fetch?: typeof globalThis.fetch;
}

/** Encodes each segment but leaves the separators alone, so paths stay readable. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function assetUrl(path: string): string {
  return `/cache/assets/${encodePath(path)}`;
}

/** Shape of one asset in the server's /api/assets payload. */
interface WireAsset {
  path: string;
  category: string;
  cached: string;
  thumbnail: string | null;
  metadata: { triangles: number };
}

function toSummary(asset: WireAsset): AssetSummary {
  return {
    path: asset.path,
    category: asset.category,
    url: `/cache/${encodePath(asset.cached)}`,
    thumbnailUrl: asset.thumbnail === null ? null : `/cache/${encodePath(asset.thumbnail)}`,
    triangles: asset.metadata.triangles,
  };
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  /**
   * One request, with the server's own error message preserved.
   * Without this, a detailed "invalid scene: unknown component" collapses into
   * a bare "fetch failed" by the time it reaches the screen.
   */
  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await doFetch(url, init);
    if (response.ok) return response;

    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') detail = body.error;
    } catch {
      // Body was not JSON; the status line is all we have, and it is enough.
    }
    throw new Error(`${url}: ${detail}`);
  }

  const json = { 'content-type': 'application/json' };

  return {
    async getProject() {
      const response = await request('/api/project', { method: 'GET' });
      return (await response.json()) as { project: ProjectSummary; scenes: string[] };
    },
    async getScene(name) {
      const response = await request(`/api/scenes/${encodeURIComponent(name)}`, { method: 'GET' });
      return (await response.json()) as SceneFile;
    },
    async putScene(name, scene) {
      await request(`/api/scenes/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: json,
        body: JSON.stringify(scene),
      });
    },
    async getAssets() {
      const response = await request('/api/assets', { method: 'GET' });
      const body = (await response.json()) as { assets: WireAsset[] };
      return body.assets.map(toSummary);
    },
    async scanAssets() {
      const response = await request('/api/assets/scan', { method: 'POST' });
      const body = (await response.json()) as { assets: WireAsset[] };
      return body.assets.map(toSummary);
    },
    async putThumbnail(path, png) {
      await request(`/api/assets/thumbnail?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: png,
      });
    },
    async build(outDir) {
      const response = await request('/api/build', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ outDir }),
      });
      return (await response.json()) as BuildSummary;
    },
  };
}
