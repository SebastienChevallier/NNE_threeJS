import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESH, TRANSFORM, type SceneFile } from '@nne/core';
import { EditorSession } from '../src/session.js';
import { createEditorStore, type EditorStore } from '../src/store.js';
import type { AssetSummary } from '../src/types.js';

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [
    { id: 1, name: 'Root', components: {} },
    {
      id: 2,
      name: 'Chair',
      parent: 1,
      components: {
        Transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
  ],
};

const asset: AssetSummary = {
  path: 'props/PRP_Chair_01.glb',
  category: 'PRP',
  url: '/cache/assets/props/PRP_Chair_01.glb',
  thumbnailUrl: null,
  triangles: 12,
};

describe('createEditorStore', () => {
  let session: EditorSession;
  let store: EditorStore;

  beforeEach(() => {
    session = new EditorSession();
    session.loadScene(scene);
    store = createEditorStore(session);
  });

  describe('selection', () => {
    it('starts with nothing selected', () => {
      expect(store.getState().selection).toBeNull();
      expect(store.getState().entity).toBeUndefined();
    });

    it('populates the entity view on select', () => {
      store.getState().select(2);
      expect(store.getState().selection).toBe(2);
      expect(store.getState().entity).toMatchObject({ id: 2, name: 'Chair' });
    });

    it('clears the entity view when selecting null', () => {
      store.getState().select(2);
      store.getState().select(null);
      expect(store.getState().selection).toBeNull();
      expect(store.getState().entity).toBeUndefined();
    });

    it('refuses to select a dead entity', () => {
      store.getState().select(99);
      expect(store.getState().selection).toBeNull();
    });
  });

  describe('refresh on command', () => {
    it('updates the selected entity view after a command', () => {
      store.getState().select(2);
      session.dispatch({ kind: 'RenameEntity', entity: 2, name: 'Renamed' });
      expect(store.getState().entity?.name).toBe('Renamed');
    });

    it('updates the hierarchy after a command', () => {
      expect(store.getState().hierarchy[0]?.children).toHaveLength(1);
      session.dispatch({ kind: 'SetParent', entity: 2, parent: null });
      expect(store.getState().hierarchy).toHaveLength(2);
    });

    it('follows the dirty flag', () => {
      expect(store.getState().dirty).toBe(false);
      session.dispatch({ kind: 'RenameEntity', entity: 2, name: 'X' });
      expect(store.getState().dirty).toBe(true);
      session.undo();
      expect(store.getState().dirty).toBe(false);
    });

    it('follows undo and redo availability', () => {
      expect(store.getState().canUndo).toBe(false);
      session.dispatch({ kind: 'RenameEntity', entity: 2, name: 'X' });
      expect(store.getState().canUndo).toBe(true);
      expect(store.getState().canRedo).toBe(false);
      session.undo();
      expect(store.getState().canRedo).toBe(true);
    });

    it('clears the selection when the selected entity is despawned', () => {
      // Leaving a dead id selected would keep a highlighted row in the
      // Hierarchy for an entity that no longer exists, and the Inspector would
      // render a blank card rather than nothing.
      store.getState().select(2);
      session.dispatch({ kind: 'DespawnEntity', entity: 2 });
      expect(store.getState().selection).toBeNull();
      expect(store.getState().entity).toBeUndefined();
    });

    it('restores the selection view when the despawn is undone', () => {
      store.getState().select(2);
      session.dispatch({ kind: 'DespawnEntity', entity: 2 });
      session.undo();
      // The entity is back, but the selection was dropped: the user reselects.
      // What must not happen is a stale view of a dead entity.
      expect(store.getState().entity).toBeUndefined();
      store.getState().select(2);
      expect(store.getState().entity?.name).toBe('Chair');
    });

    it('rebuilds everything when a new scene is loaded', () => {
      store.getState().select(2);
      session.loadScene({ version: 1, name: 'Other', entities: [] });
      expect(store.getState().hierarchy).toEqual([]);
      expect(store.getState().selection).toBeNull();
    });
  });

  describe('notification', () => {
    it('notifies subscribers when the selection changes', () => {
      const listener = vi.fn();
      store.subscribe(listener);
      store.getState().select(2);
      expect(listener).toHaveBeenCalled();
    });

    it('notifies subscribers when a command lands', () => {
      const listener = vi.fn();
      store.subscribe(listener);
      session.dispatch({ kind: 'RenameEntity', entity: 2, name: 'X' });
      expect(listener).toHaveBeenCalled();
    });

    it('stops refreshing once detached', () => {
      store.getState().select(2);
      store.getState().detach();
      session.dispatch({ kind: 'RenameEntity', entity: 2, name: 'Renamed' });
      // The store is no longer listening, so it still shows the old name.
      expect(store.getState().entity?.name).toBe('Chair');
    });
  });

  describe('assets and phase', () => {
    it('replaces the asset list', () => {
      store.getState().setAssets([asset]);
      expect(store.getState().assets).toEqual([asset]);
    });

    it('switches phase', () => {
      expect(store.getState().phase).toBe('edit');
      store.getState().setPhase('play');
      expect(store.getState().phase).toBe('play');
    });

    it('clears the selection when entering play', () => {
      // Play runs on a clone; a selection pointing into the edited world would
      // highlight an entity the played world does not share.
      store.getState().select(2);
      store.getState().setPhase('play');
      expect(store.getState().selection).toBeNull();
    });
  });

  describe('scene name', () => {
    it('tracks the loaded scene', () => {
      expect(store.getState().sceneName).toBe('Scene_01');
      session.loadScene({ version: 1, name: 'Level_02', entities: [] });
      expect(store.getState().sceneName).toBe('Level_02');
    });
  });

  describe('component views', () => {
    it('exposes the components of the selected entity', () => {
      store.getState().select(2);
      expect(store.getState().entity?.components.map((c) => c.type)).toEqual([TRANSFORM]);
    });

    it('reflects a component added by command', () => {
      store.getState().select(2);
      session.dispatch({
        kind: 'AddComponent',
        entity: 2,
        type: MESH,
        data: { asset: null, castShadow: true },
      });
      expect(store.getState().entity?.components.map((c) => c.type)).toEqual([MESH, TRANSFORM]);
    });
  });
});
