import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA, MESH, TRANSFORM, type SceneFile } from '@nne/core';
import { createController, type EditorController } from '../src/controller.js';
import type { ApiClient } from '../src/api/client.js';

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

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getProject: vi.fn().mockResolvedValue({ project: {}, scenes: [] }),
    getScene: vi.fn().mockResolvedValue(scene),
    putScene: vi.fn().mockResolvedValue(undefined),
    getAssets: vi.fn().mockResolvedValue([]),
    scanAssets: vi.fn().mockResolvedValue([]),
    putThumbnail: vi.fn().mockResolvedValue(undefined),
    build: vi.fn().mockResolvedValue({ scenes: [], assets: [] }),
    ...overrides,
  } as ApiClient;
}

describe('createController', () => {
  let controller: EditorController;
  let client: ApiClient;

  beforeEach(async () => {
    client = fakeClient();
    // No socket: the watch connection is injected as a no-op.
    controller = createController({ client, connect: () => () => undefined });
    await controller.loadScene('Scene_01');
  });

  describe('rename', () => {
    it('renames the selected entity', () => {
      controller.select(2);
      controller.rename('Renamed');
      expect(controller.session.world.getName(2)).toBe('Renamed');
    });

    it('does nothing with no selection', () => {
      controller.rename('X');
      expect(controller.session.isDirty()).toBe(false);
    });
  });

  describe('reparent', () => {
    it('reparents through a command', () => {
      controller.reparent(2, null);
      expect(controller.session.world.getParent(2)).toBeNull();
    });

    it('refuses a reparent the World would reject, without throwing', () => {
      // Dropping a parent onto its own child: the World answers this with an
      // exception, which mid-drag would be an unhandled error, not a UI.
      expect(() => controller.reparent(1, 2)).not.toThrow();
      expect(controller.session.world.getParent(1)).toBeNull();
      expect(controller.session.isDirty()).toBe(false);
    });

    it('does nothing when the parent is already the current one', () => {
      controller.reparent(2, 1);
      expect(controller.session.isDirty()).toBe(false);
    });
  });

  describe('setField', () => {
    beforeEach(() => controller.select(2));

    it('writes a coerced value', () => {
      controller.setField(TRANSFORM, 'position', ['5', '6', '7']);
      expect(controller.session.world.peek(2, TRANSFORM)).toMatchObject({ position: [5, 6, 7] });
    });

    it('leaves the other fields alone', () => {
      controller.setField(TRANSFORM, 'position', ['5', '6', '7']);
      expect(controller.session.world.peek(2, TRANSFORM)).toMatchObject({ scale: [1, 1, 1] });
    });

    it('refuses an unusable value rather than writing a broken component', () => {
      // A half-typed number reads as ''. Writing 0 would destroy the value the
      // user is replacing; writing '' would produce a scene the server refuses,
      // a long way from the keystroke that caused it.
      controller.setField(TRANSFORM, 'position', ['5', '', '7']);
      expect(controller.session.world.peek(2, TRANSFORM)).toMatchObject({ position: [1, 0, 0] });
      expect(controller.session.isDirty()).toBe(false);
    });

    it('ignores an unknown field', () => {
      controller.setField(TRANSFORM, 'nope', 1);
      expect(controller.session.isDirty()).toBe(false);
    });

    it('ignores a component the entity does not have', () => {
      controller.setField(MESH, 'castShadow', true);
      expect(controller.session.isDirty()).toBe(false);
    });
  });

  describe('addComponent and removeComponent', () => {
    beforeEach(() => controller.select(2));

    it('adds with the registry defaults', () => {
      controller.addComponent(CAMERA);
      expect(controller.session.world.peek(2, CAMERA)).toMatchObject({ fov: 60, active: true });
    });

    it('produces a component the registry accepts', () => {
      controller.addComponent(CAMERA);
      const data = controller.session.world.get(2, CAMERA);
      expect(controller.session.registry.validate(CAMERA, data)).toEqual([]);
    });

    it('does not add a component twice', () => {
      controller.addComponent(CAMERA);
      controller.addComponent(CAMERA);
      expect(controller.store.getState().entity?.components
        .filter((c) => c.type === CAMERA)).toHaveLength(1);
    });

    it('removes a component', () => {
      controller.removeComponent(TRANSFORM);
      expect(controller.session.world.has(2, TRANSFORM)).toBe(false);
    });

    it('ignores removing a component that is not there', () => {
      controller.removeComponent(MESH);
      expect(controller.session.isDirty()).toBe(false);
    });

    it('can be undone', () => {
      controller.addComponent(CAMERA);
      controller.undo();
      expect(controller.session.world.has(2, CAMERA)).toBe(false);
    });
  });

  describe('addableComponents', () => {
    it('offers only what the entity lacks', () => {
      controller.select(2);
      expect(controller.addableComponents([TRANSFORM])).not.toContain(TRANSFORM);
      expect(controller.addableComponents([TRANSFORM])).toContain(MESH);
    });
  });

  describe('save', () => {
    it('sends the scene under its loaded name and clears the dirty flag', async () => {
      controller.select(2);
      controller.rename('Renamed');
      await controller.save();

      expect(client.putScene).toHaveBeenCalledWith('Scene_01', expect.anything());
      expect(controller.session.isDirty()).toBe(false);
    });
  });

  describe('build', () => {
    it('defaults to dist', async () => {
      await controller.build();
      expect(client.build).toHaveBeenCalledWith('dist');
    });
  });

  describe('drag state', () => {
    it('remembers and clears the dragged asset', () => {
      const asset = {
        path: 'p/PRP_A.glb', category: 'PRP', url: '/cache/assets/p/PRP_A.glb',
        thumbnailUrl: null, triangles: 1,
      };
      controller.beginDrag(asset);
      expect(controller.draggedAsset()).toBe(asset);
      controller.endDrag();
      expect(controller.draggedAsset()).toBeUndefined();
    });
  });

  describe('watch wiring', () => {
    it('refreshes the asset list on an asset event', async () => {
      let emit: ((event: { type: 'asset-changed'; path: string }) => void) | undefined;
      const c = createController({
        client,
        connect: (options) => {
          emit = options.onEvent as typeof emit;
          return () => undefined;
        },
      });
      await c.loadScene('Scene_01');

      (client.getAssets as ReturnType<typeof vi.fn>).mockClear();
      emit?.({ type: 'asset-changed', path: 'a.glb' });
      await vi.waitFor(() => expect(client.getAssets).toHaveBeenCalled());
    });

    it('does not reload the open scene over unsaved work', async () => {
      let emit: ((event: { type: 'scene-changed'; name: string }) => void) | undefined;
      const c = createController({
        client,
        connect: (options) => {
          emit = options.onEvent as typeof emit;
          return () => undefined;
        },
      });
      await c.loadScene('Scene_01');
      c.select(2);
      c.rename('Unsaved edit');

      (client.getScene as ReturnType<typeof vi.fn>).mockClear();
      emit?.({ type: 'scene-changed', name: 'Scene_01' });
      expect(client.getScene).not.toHaveBeenCalled();
      expect(c.session.world.getName(2)).toBe('Unsaved edit');
    });
  });

  describe('dispose', () => {
    it('disconnects the watcher and detaches the store', () => {
      const disconnect = vi.fn();
      const c = createController({ client, connect: () => disconnect });
      c.dispose();
      expect(disconnect).toHaveBeenCalled();
    });
  });
});
