import { createStore, type StoreApi } from 'zustand/vanilla';
import type { EntityId } from '@nne/core';
import { buildHierarchy } from './model/hierarchy.js';
import type { EditorSession } from './session.js';
import type { AssetSummary, EditorPhase, EntityView, HierarchyNode } from './types.js';

export interface EditorState {
  /** The selected entity, or null. */
  selection: EntityId | null;
  /** The selected entity, serialized. The only entity shape React reads. */
  entity: EntityView | undefined;
  hierarchy: HierarchyNode[];
  assets: AssetSummary[];
  phase: EditorPhase;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  sceneName: string;

  select(entity: EntityId | null): void;
  setAssets(assets: AssetSummary[]): void;
  setPhase(phase: EditorPhase): void;
  /** Stops listening to the session. Called when the editor tears down. */
  detach(): void;
}

export type EditorStore = StoreApi<EditorState>;

/**
 * The boundary React reads from, and the only one.
 *
 * Subscribes to the session and recomputes its view after each command — which
 * means once per user action, never per frame. The gizmo emits a single command
 * on release rather than one per mouse move, so dragging a gizmo costs one
 * recompute, not sixty a second.
 */
export function createEditorStore(session: EditorSession): EditorStore {
  const store = createStore<EditorState>((set, get) => ({
    selection: null,
    entity: undefined,
    hierarchy: buildHierarchy(session.world),
    assets: [],
    phase: 'edit',
    dirty: session.isDirty(),
    canUndo: session.canUndo(),
    canRedo: session.canRedo(),
    sceneName: session.sceneName,

    select(entity) {
      // A dead id would leave the Hierarchy highlighting a row that is not
      // there and the Inspector rendering an empty card.
      const view = entity === null ? undefined : session.viewOf(entity);
      set({ selection: view ? entity : null, entity: view });
    },

    setAssets(assets) {
      set({ assets });
    },

    setPhase(phase) {
      // Play runs on a clone of the world; a selection pointing into the edited
      // world would highlight an entity the played world does not share.
      if (phase === 'play') set({ phase, selection: null, entity: undefined });
      else set({ phase });
    },

    detach() {
      unsubscribe();
    },
  }));

  const unsubscribe = session.subscribe(() => {
    const { selection } = store.getState();
    const entity = selection === null ? undefined : session.viewOf(selection);
    store.setState({
      // The selected entity may have been despawned by the command that just
      // landed — including by an undo of its spawn.
      selection: entity ? selection : null,
      entity,
      hierarchy: buildHierarchy(session.world),
      dirty: session.isDirty(),
      canUndo: session.canUndo(),
      canRedo: session.canRedo(),
      sceneName: session.sceneName,
    });
  });

  return store;
}
