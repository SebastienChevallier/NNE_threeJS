import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESH, TRANSFORM, type SceneFile } from '@nne/core';
import { EditorSession } from '../src/session.js';

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [
    {
      id: 1,
      name: 'Root',
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
    {
      id: 2,
      name: 'Chair',
      parent: 1,
      components: {
        Transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Mesh: { asset: 'props/PRP_Chair_01.glb', castShadow: true },
      },
    },
  ],
};

describe('EditorSession', () => {
  let session: EditorSession;

  beforeEach(() => {
    session = new EditorSession();
    session.loadScene(scene);
  });

  describe('loadScene', () => {
    it('rebuilds the world from the file', () => {
      expect(session.world.entities()).toEqual([1, 2]);
      expect(session.world.getName(2)).toBe('Chair');
      expect(session.world.getParent(2)).toBe(1);
    });

    it('starts clean, with nothing to undo', () => {
      expect(session.isDirty()).toBe(false);
      expect(session.canUndo()).toBe(false);
      expect(session.canRedo()).toBe(false);
    });

    it('clears the history of the previous scene', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'X' });
      session.loadScene(scene);
      // Undoing here would rename an entity in a scene that never saw the edit.
      expect(session.canUndo()).toBe(false);
    });

    it('clears the dirty flag left by the previous scene', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'X' });
      session.loadScene(scene);
      expect(session.isDirty()).toBe(false);
    });
  });

  describe('dispatch', () => {
    it('applies the command to the world', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(session.world.getName(1)).toBe('Renamed');
    });

    it('marks the session dirty', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(session.isDirty()).toBe(true);
    });

    it('notifies subscribers', () => {
      const listener = vi.fn();
      session.subscribe(listener);
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops notifying after unsubscribe', () => {
      const listener = vi.fn();
      session.subscribe(listener)();
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('undo and redo', () => {
    it('restores the previous value', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      session.undo();
      expect(session.world.getName(1)).toBe('Root');
      session.redo();
      expect(session.world.getName(1)).toBe('Renamed');
    });

    it('reports what is available', () => {
      expect(session.canUndo()).toBe(false);
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(session.canUndo()).toBe(true);
      expect(session.canRedo()).toBe(false);
      session.undo();
      expect(session.canRedo()).toBe(true);
    });

    it('notifies subscribers, so the panels refresh', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      const listener = vi.fn();
      session.subscribe(listener);
      session.undo();
      expect(listener).toHaveBeenCalled();
    });

    it('does not notify when there is nothing to undo', () => {
      const listener = vi.fn();
      session.subscribe(listener);
      expect(session.undo()).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it('undoing back to the saved state clears the dirty flag', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(session.isDirty()).toBe(true);
      session.undo();
      expect(session.isDirty()).toBe(false);
    });

    it('redoing past the saved state sets it again', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      session.undo();
      session.redo();
      expect(session.isDirty()).toBe(true);
    });
  });

  describe('markSaved', () => {
    it('clears the dirty flag at the current point in history', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      session.markSaved();
      expect(session.isDirty()).toBe(false);
    });

    it('undoing past the save point makes it dirty again', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'A' });
      session.markSaved();
      session.undo();
      expect(session.isDirty()).toBe(true);
    });

    it('redoing back to the save point clears it again', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'A' });
      session.markSaved();
      session.undo();
      session.redo();
      expect(session.isDirty()).toBe(false);
    });
  });

  describe('spawnEntity', () => {
    it('creates an entity through a command, so it can be undone', () => {
      const id = session.spawnEntity('New', null);
      expect(session.world.alive(id)).toBe(true);
      session.undo();
      expect(session.world.alive(id)).toBe(false);
    });

    it('never reuses an id', () => {
      const first = session.spawnEntity('A', null);
      const second = session.spawnEntity('B', null);
      expect(second).not.toBe(first);
    });

    it('does not collide with ids already in the loaded scene', () => {
      expect(session.spawnEntity('A', null)).toBeGreaterThan(2);
    });

    it('parents the new entity when asked', () => {
      const id = session.spawnEntity('Child', 1);
      expect(session.world.getParent(id)).toBe(1);
    });
  });

  describe('viewOf', () => {
    it('serializes an entity for React', () => {
      expect(session.viewOf(2)).toEqual({
        id: 2,
        name: 'Chair',
        parent: 1,
        // The registry lists component types in its own stable order, which
        // happens to be alphabetical: Mesh before Transform.
        components: [
          { type: MESH, data: { asset: 'props/PRP_Chair_01.glb', castShadow: true } },
          { type: TRANSFORM, data: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        ],
      });
    });

    it('returns copies, so React cannot mutate the world by accident', () => {
      const view = session.viewOf(2);
      // Looked up by type, not by index: this test is about copying, and it
      // should not break the day the registry's ordering changes.
      const transform = view?.components.find((c) => c.type === TRANSFORM);
      (transform?.data['position'] as number[])[0] = 99;
      expect(session.world.peek(2, TRANSFORM)).toMatchObject({ position: [1, 0, 0] });
    });

    it('returns undefined for a dead entity', () => {
      expect(session.viewOf(99)).toBeUndefined();
    });

    it('lists components in the registry order, not the order they were added', () => {
      // The Inspector's card order must not depend on which component the user
      // happened to add first. The registry's order is stable and deterministic,
      // which is the property that matters; that it is alphabetical is incidental.
      const id = session.spawnEntity('E', null);
      session.dispatch({
        kind: 'AddComponent',
        entity: id,
        type: MESH,
        data: { asset: null, castShadow: true },
      });
      session.dispatch({
        kind: 'AddComponent',
        entity: id,
        type: TRANSFORM,
        data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      });
      expect(session.viewOf(id)?.components.map((c) => c.type)).toEqual([MESH, TRANSFORM]);
    });
  });

  describe('toSceneFile', () => {
    it('round-trips the loaded scene', () => {
      expect(session.toSceneFile('Scene_01')).toEqual(scene);
    });
  });
});
