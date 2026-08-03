import { beforeEach, describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { TRANSFORM, type Command, type SceneFile } from '@nne/core';
import { EditorSession } from '../src/session.js';
import { createGizmoBridge, type GizmoSource } from '../src/viewport/gizmo.js';

const scene: SceneFile = {
  version: 1,
  name: 'S',
  entities: [{
    id: 1,
    name: 'Chair',
    components: { Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
  }],
};

/** Stands in for TransformControls: same two events, no DOM. */
function fakeControls() {
  const listeners = new Map<string, ((event: { value?: boolean }) => void)[]>();
  const source: GizmoSource & { object: Object3D | undefined } = {
    object: undefined,
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
    },
  };
  return {
    source,
    emit(type: string, value?: boolean) {
      for (const listener of listeners.get(type) ?? []) listener({ value });
    },
    startDrag() { this.emit('dragging-changed', true); },
    endDrag() { this.emit('dragging-changed', false); },
  };
}

describe('createGizmoBridge', () => {
  let session: EditorSession;
  let controls: ReturnType<typeof fakeControls>;
  let object: Object3D;
  let dispatched: Command[];

  beforeEach(() => {
    session = new EditorSession();
    session.loadScene(scene);
    dispatched = [];
    const original = session.dispatch.bind(session);
    session.dispatch = (command: Command) => {
      dispatched.push(command);
      original(command);
    };

    object = new Object3D();
    object.userData['entity'] = 1;
    controls = fakeControls();
    controls.source.object = object;
    createGizmoBridge({ session, controls: controls.source });
  });

  it('emits nothing while the drag is in progress', () => {
    controls.startDrag();
    object.position.set(1, 0, 0);
    controls.emit('objectChange');
    object.position.set(2, 0, 0);
    controls.emit('objectChange');
    expect(dispatched).toEqual([]);
  });

  it('emits exactly one command on release', () => {
    // This is what makes a drag a single undo step instead of sixty.
    controls.startDrag();
    for (let i = 1; i <= 20; i++) {
      object.position.set(i, 0, 0);
      controls.emit('objectChange');
    }
    controls.endDrag();
    expect(dispatched).toHaveLength(1);
  });

  it('carries the final value, not an intermediate one', () => {
    controls.startDrag();
    object.position.set(1, 0, 0);
    controls.emit('objectChange');
    object.position.set(9, 8, 7);
    controls.emit('objectChange');
    controls.endDrag();

    expect(dispatched[0]).toMatchObject({
      kind: 'SetComponent',
      entity: 1,
      type: TRANSFORM,
      data: { position: [9, 8, 7] },
    });
  });

  it('writes the value into the world', () => {
    controls.startDrag();
    object.position.set(4, 0, 0);
    controls.endDrag();
    expect(session.world.peek(1, TRANSFORM)).toMatchObject({ position: [4, 0, 0] });
  });

  it('makes the whole drag one undo step', () => {
    controls.startDrag();
    for (let i = 1; i <= 10; i++) {
      object.position.set(i, 0, 0);
      controls.emit('objectChange');
    }
    controls.endDrag();

    session.undo();
    expect(session.world.peek(1, TRANSFORM)).toMatchObject({ position: [0, 0, 0] });
  });

  it('emits nothing when the object did not actually move', () => {
    // A click on the gizmo that does not drag must not push an undo entry that
    // does nothing, which would make undo feel broken.
    controls.startDrag();
    controls.endDrag();
    expect(dispatched).toEqual([]);
  });

  it('captures rotation and scale too, not only position', () => {
    controls.startDrag();
    object.rotation.set(0, 1.5, 0);
    object.scale.set(2, 2, 2);
    controls.endDrag();

    expect(dispatched[0]).toMatchObject({
      data: { rotation: [0, 1.5, 0], scale: [2, 2, 2] },
    });
  });

  it('emits nothing when no object is attached', () => {
    controls.source.object = undefined;
    controls.startDrag();
    controls.endDrag();
    expect(dispatched).toEqual([]);
  });

  it('emits nothing when the attached object carries no entity', () => {
    controls.source.object = new Object3D();
    controls.startDrag();
    controls.source.object.position.set(1, 0, 0);
    controls.endDrag();
    expect(dispatched).toEqual([]);
  });

  it('emits nothing when the entity died mid-drag', () => {
    controls.startDrag();
    object.position.set(1, 0, 0);
    session.dispatch({ kind: 'DespawnEntity', entity: 1 });
    dispatched.length = 0;
    controls.endDrag();
    expect(dispatched).toEqual([]);
  });

  it('handles two drags in a row independently', () => {
    controls.startDrag();
    object.position.set(1, 0, 0);
    controls.endDrag();
    controls.startDrag();
    object.position.set(2, 0, 0);
    controls.endDrag();

    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).toMatchObject({ data: { position: [2, 0, 0] } });
  });

  it('stops listening once detached', () => {
    const controls2 = fakeControls();
    controls2.source.object = object;
    const detach = createGizmoBridge({ session, controls: controls2.source });
    detach();

    controls2.startDrag();
    object.position.set(5, 0, 0);
    controls2.endDrag();
    expect(dispatched).toEqual([]);
  });
});
