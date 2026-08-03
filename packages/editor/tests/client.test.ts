import { describe, expect, it, vi } from 'vitest';
import type { SceneFile } from '@nne/core';
import { assetUrl, createApiClient } from '../src/api/client.js';

const scene: SceneFile = { version: 1, name: 'Scene_01', entities: [] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('loads the project and its scene list', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({ project: { name: 'demo', version: 1, startScene: null }, scenes: ['A'] }),
    );
    const client = createApiClient({ fetch });

    expect(await client.getProject()).toEqual({
      project: { name: 'demo', version: 1, startScene: null },
      scenes: ['A'],
    });
    expect(fetch).toHaveBeenCalledWith('/api/project', expect.anything());
  });

  it('loads a scene by name', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(scene));
    expect(await createApiClient({ fetch }).getScene('Scene_01')).toEqual(scene);
    expect(fetch).toHaveBeenCalledWith('/api/scenes/Scene_01', expect.anything());
  });

  it('encodes a scene name that needs it', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(scene));
    await createApiClient({ fetch }).getScene('a b');
    expect(fetch).toHaveBeenCalledWith('/api/scenes/a%20b', expect.anything());
  });

  it('saves a scene as JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await createApiClient({ fetch }).putScene('Scene_01', scene);

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scenes/Scene_01');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual(scene);
  });

  it('surfaces the server error message, not a generic failure', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'invalid scene:\n  entities.0: unknown component "Nope"' }, 400),
    );
    await expect(createApiClient({ fetch }).putScene('Scene_01', scene))
      .rejects.toThrow(/unknown component "Nope"/);
  });

  it('still reports something useful when the error body is not JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(createApiClient({ fetch }).getProject()).rejects.toThrow(/500/);
  });

  it('maps assets to the urls the loader needs', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      assets: [{
        path: 'props/PRP_Chair_01.glb',
        category: 'PRP',
        cached: 'assets/props/PRP_Chair_01.glb',
        thumbnail: 'thumbnails/props/PRP_Chair_01.png',
        metadata: { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, animations: [], triangles: 42 },
        sourceMtimeMs: 0,
        sourceSize: 0,
      }],
    }));

    expect(await createApiClient({ fetch }).getAssets()).toEqual([{
      path: 'props/PRP_Chair_01.glb',
      category: 'PRP',
      url: '/cache/assets/props/PRP_Chair_01.glb',
      thumbnailUrl: '/cache/thumbnails/props/PRP_Chair_01.png',
      triangles: 42,
    }]);
  });

  it('reports a null thumbnail as null rather than a broken url', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      assets: [{
        path: 'p/PRP_A.glb', category: 'PRP', cached: 'assets/p/PRP_A.glb', thumbnail: null,
        metadata: { bounds: { min: [0, 0, 0], max: [0, 0, 0] }, animations: [], triangles: 0 },
        sourceMtimeMs: 0, sourceSize: 0,
      }],
    }));
    expect((await createApiClient({ fetch }).getAssets())[0]?.thumbnailUrl).toBeNull();
  });

  it('posts a build request', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ scenes: ['A'], assets: [] }));
    await createApiClient({ fetch }).build('dist');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/build');
    expect(JSON.parse(init.body as string)).toEqual({ outDir: 'dist' });
  });

  it('uploads a thumbnail as png bytes', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({}));
    await createApiClient({ fetch }).putThumbnail('props/PRP_A.glb', new Uint8Array([1, 2]));
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/assets/thumbnail?path=props%2FPRP_A.glb');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
  });

  it('scans assets through the server', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ assets: [] }));
    expect(await createApiClient({ fetch }).scanAssets()).toEqual([]);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/assets/scan');
    expect(init.method).toBe('POST');
  });
});

describe('assetUrl', () => {
  it('builds a cache url from an asset path', () => {
    expect(assetUrl('props/PRP_Chair_01.glb')).toBe('/cache/assets/props/PRP_Chair_01.glb');
  });

  it('encodes each segment without encoding the separators', () => {
    expect(assetUrl('my props/PRP A.glb')).toBe('/cache/assets/my%20props/PRP%20A.glb');
  });
});
