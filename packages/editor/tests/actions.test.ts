import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneFile } from '@nne/core';
import { EditorSession } from '../src/session.js';
import { runBuild, saveScene } from '../src/actions.js';
import type { ApiClient } from '../src/api/client.js';

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [{ id: 1, name: 'Root', components: {} }],
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getProject: vi.fn(),
    getScene: vi.fn(),
    putScene: vi.fn().mockResolvedValue(undefined),
    getAssets: vi.fn(),
    scanAssets: vi.fn(),
    putThumbnail: vi.fn(),
    build: vi.fn().mockResolvedValue({ scenes: ['Scene_01'], assets: [] }),
    ...overrides,
  } as ApiClient;
}

describe('saveScene', () => {
  let session: EditorSession;

  beforeEach(() => {
    session = new EditorSession();
    session.loadScene(scene);
    session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
  });

  it('sends the serialized scene under its name', async () => {
    const client = fakeClient();
    await saveScene(session, client, 'Scene_01');

    expect(client.putScene).toHaveBeenCalledWith('Scene_01', expect.objectContaining({
      version: 1,
      name: 'Scene_01',
    }));
  });

  it('clears the dirty flag once the server accepted it', async () => {
    expect(session.isDirty()).toBe(true);
    await saveScene(session, fakeClient(), 'Scene_01');
    expect(session.isDirty()).toBe(false);
  });

  it('leaves the session dirty when the save fails', async () => {
    // Marking saved before the response would lose the "unsaved" state at the
    // exact moment it matters most.
    const client = fakeClient({
      putScene: vi.fn().mockRejectedValue(new Error('network down')),
    });
    await expect(saveScene(session, client, 'Scene_01')).rejects.toThrow('network down');
    expect(session.isDirty()).toBe(true);
  });

  it('saves the current state, including edits made after the last save', async () => {
    const client = fakeClient();
    await saveScene(session, client, 'Scene_01');
    session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Again' });
    await saveScene(session, client, 'Scene_01');

    const [, sent] = (client.putScene as ReturnType<typeof vi.fn>).mock.calls[1] as [string, SceneFile];
    expect(sent.entities[0]?.name).toBe('Again');
  });
});

describe('runBuild', () => {
  it('passes the output folder through and returns the summary', async () => {
    const client = fakeClient();
    expect(await runBuild(client, 'dist')).toEqual({ scenes: ['Scene_01'], assets: [] });
    expect(client.build).toHaveBeenCalledWith('dist');
  });

  it('propagates a refusal from the server rather than swallowing it', async () => {
    const client = fakeClient({
      build: vi.fn().mockRejectedValue(new Error('refus de builder dans la racine')),
    });
    await expect(runBuild(client, '.')).rejects.toThrow(/refus/);
  });
});
