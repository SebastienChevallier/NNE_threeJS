import type { Object3D } from 'three';
import { TRANSFORM } from '@nne/core';
import type { EditorSession } from '../session.js';
import { entityOf } from './selection.js';

/**
 * The part of `TransformControls` this bridge uses.
 *
 * Declared as an interface rather than the concrete class so the bridge is
 * testable without a DOM: the real controls need a canvas, these two events
 * do not.
 */
export interface GizmoSource {
  object?: Object3D | undefined;
  addEventListener(type: string, listener: (event: { value?: boolean }) => void): void;
  removeEventListener(type: string, listener: (event: { value?: boolean }) => void): void;
}

export interface GizmoBridgeOptions {
  session: EditorSession;
  controls: GizmoSource;
}

/** The three numbers of a transform triple, read off an Object3D. */
function snapshot(object: Object3D): {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
} {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}

function same(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Turns a gizmo drag into a single command.
 *
 * The gizmo moves its object directly, sixty times a second; writing each of
 * those into the Transform would make one drag sixty undo steps and sixty store
 * recomputes. So nothing is written during the drag — the component is updated
 * once, on release, from the object's final state.
 *
 * Returns a function that detaches the listeners.
 */
export function createGizmoBridge(options: GizmoBridgeOptions): () => void {
  const { session, controls } = options;
  let before: ReturnType<typeof snapshot> | undefined;

  const onDraggingChanged = (event: { value?: boolean }): void => {
    const object = controls.object;

    if (event.value === true) {
      before = object ? snapshot(object) : undefined;
      return;
    }

    const start = before;
    before = undefined;
    if (!object || !start) return;

    const entity = entityOf(object);
    // The entity can be despawned mid-drag — by an undo, or by the AI panel
    // later on. Writing a Transform onto a dead entity would throw.
    if (entity === undefined || !session.world.alive(entity)) return;

    const after = snapshot(object);
    // A click on the gizmo that does not move anything must not push an undo
    // entry that does nothing: undo would then appear to do nothing too.
    if (
      same(start.position, after.position)
      && same(start.rotation, after.rotation)
      && same(start.scale, after.scale)
    ) {
      return;
    }

    session.dispatch({ kind: 'SetComponent', entity, type: TRANSFORM, data: after });
  };

  controls.addEventListener('dragging-changed', onDraggingChanged);

  return () => {
    controls.removeEventListener('dragging-changed', onDraggingChanged);
  };
}
