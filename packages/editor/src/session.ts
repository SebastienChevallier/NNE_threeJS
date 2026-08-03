import {
  CommandBus, ComponentRegistry, World,
  deserializeScene, registerBuiltins, serializeScene,
  type Command, type ComponentData, type EntityId, type SceneFile,
} from '@nne/core';
import type { EntityView } from './types.js';

/**
 * Owns the World and the CommandBus, and is the only thing in this package
 * allowed to touch either.
 *
 * Everything else — React, gizmos, panels — goes through `dispatch`, which is
 * what makes undo exhaustive rather than best-effort.
 */
export class EditorSession {
  readonly registry = new ComponentRegistry();
  world = new World();

  private bus = new CommandBus(this.world);
  private readonly listeners = new Set<() => void>();
  /** Position in history. See `isDirty`. */
  private depth = 0;
  private depthAtSave = 0;

  constructor() {
    registerBuiltins(this.registry);
  }

  loadScene(file: SceneFile): void {
    this.world = deserializeScene(file);
    // A fresh bus, because the old history describes a world that is gone:
    // undoing into it would edit entities the new scene never had.
    this.bus = new CommandBus(this.world);
    this.depth = 0;
    this.depthAtSave = 0;
    this.notify();
  }

  toSceneFile(name: string): SceneFile {
    return serializeScene(this.world, name);
  }

  dispatch(command: Command): void {
    this.bus.dispatch(command);
    this.depth++;
    this.notify();
  }

  undo(): boolean {
    if (!this.bus.undo()) return false;
    this.depth--;
    this.notify();
    return true;
  }

  redo(): boolean {
    if (!this.bus.redo()) return false;
    this.depth++;
    this.notify();
    return true;
  }

  canUndo(): boolean {
    return this.bus.canUndo();
  }

  canRedo(): boolean {
    return this.bus.canRedo();
  }

  /**
   * Dirty is a position in history, not a boolean that edits set.
   *
   * Undoing back to the saved point makes the document clean again, which is
   * what a user expects and what a plain flag gets wrong — it would leave the
   * editor claiming unsaved work after the work has been undone.
   */
  isDirty(): boolean {
    return this.depth !== this.depthAtSave;
  }

  markSaved(): void {
    this.depthAtSave = this.depth;
    this.notify();
  }

  /**
   * Reserves an id, then spawns through a command.
   *
   * A `SpawnEntity` command carries its id — that is what makes its inverse
   * computable — so the id has to exist before the command does. Reserving one
   * creates nothing, which is why this is not a mutation outside the bus.
   */
  spawnEntity(name: string, parent: EntityId | null): EntityId {
    const entity = this.world.allocateId();
    this.dispatch({ kind: 'SpawnEntity', entity, name, parent });
    return entity;
  }

  /** The serialized shape React reads. Copies throughout. */
  viewOf(entity: EntityId): EntityView | undefined {
    if (!this.world.alive(entity)) return undefined;

    const components = this.registry.list()
      .filter((type) => this.world.has(entity, type))
      // Ordered by the registry, which is stable and independent of the order the
      // user added components in. `world.get` copies defensively, which is what
      // is wanted here: React must not hold a reference a later command would
      // change under it.
      .map((type) => ({ type, data: this.world.get(entity, type) as ComponentData }));

    return {
      id: entity,
      name: this.world.getName(entity),
      parent: this.world.getParent(entity),
      components,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    // Copied before iterating: a listener may unsubscribe itself in response.
    for (const listener of [...this.listeners]) listener();
  }
}
