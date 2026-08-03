import type { World } from './world.js';
import type { ComponentData, ComponentType, EntityId } from './types.js';

/**
 * Every mutation the editor can perform. Commands are plain JSON so they can
 * be logged, replayed, and later emitted by the AI panel.
 */
export type Command =
  | { kind: 'SpawnEntity'; entity: EntityId; name: string; parent: EntityId | null }
  | { kind: 'DespawnEntity'; entity: EntityId }
  | { kind: 'SetComponent'; entity: EntityId; type: ComponentType; data: ComponentData }
  | { kind: 'AddComponent'; entity: EntityId; type: ComponentType; data: ComponentData }
  | { kind: 'RemoveComponent'; entity: EntityId; type: ComponentType }
  | { kind: 'SetParent'; entity: EntityId; parent: EntityId | null }
  | { kind: 'RenameEntity'; entity: EntityId; name: string };

export function applyCommand(world: World, command: Command): void {
  switch (command.kind) {
    case 'SpawnEntity':
      world.spawnWithId(command.entity, command.name, command.parent);
      return;
    case 'DespawnEntity':
      world.despawn(command.entity);
      return;
    case 'SetComponent':
    case 'AddComponent':
      world.set(command.entity, command.type, command.data);
      return;
    case 'RemoveComponent':
      world.remove(command.entity, command.type);
      return;
    case 'SetParent':
      world.setParent(command.entity, command.parent);
      return;
    case 'RenameEntity':
      world.setName(command.entity, command.name);
      return;
  }
}

/**
 * The commands that undo `command`, computed against the world state BEFORE
 * it is applied. Returned in the order they must be replayed.
 */
export function invertCommand(world: World, command: Command): Command[] {
  switch (command.kind) {
    case 'SpawnEntity':
      return [{ kind: 'DespawnEntity', entity: command.entity }];

    case 'DespawnEntity': {
      // Rebuild the whole subtree: parents first, then their components.
      const restore: Command[] = [];
      for (const id of world.subtree(command.entity)) {
        restore.push({
          kind: 'SpawnEntity',
          entity: id,
          name: world.getName(id),
          parent: world.getParent(id),
        });
        for (const [type, data] of Object.entries(world.componentsOf(id))) {
          restore.push({ kind: 'SetComponent', entity: id, type, data });
        }
      }
      return restore;
    }

    case 'SetComponent':
    case 'AddComponent': {
      const previous = world.get(command.entity, command.type);
      return previous === undefined
        ? [{ kind: 'RemoveComponent', entity: command.entity, type: command.type }]
        : [{ kind: 'SetComponent', entity: command.entity, type: command.type, data: previous }];
    }

    case 'RemoveComponent': {
      const previous = world.get(command.entity, command.type);
      return previous === undefined
        ? []
        : [{ kind: 'SetComponent', entity: command.entity, type: command.type, data: previous }];
    }

    case 'SetParent':
      return [{
        kind: 'SetParent',
        entity: command.entity,
        parent: world.getParent(command.entity),
      }];

    case 'RenameEntity':
      return [{
        kind: 'RenameEntity',
        entity: command.entity,
        name: world.getName(command.entity),
      }];
  }
}

interface HistoryEntry {
  redo: Command[];
  undo: Command[];
}

/**
 * The single route through which the editor mutates the world.
 * Because the inverse is captured on every dispatch, undo covers every
 * mutation by construction — a new command kind cannot forget to support it.
 */
export class CommandBus {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<(command: Command) => void>();

  constructor(private readonly world: World) {}

  dispatch(command: Command): void {
    const undo = invertCommand(this.world, command);
    applyCommand(this.world, command);
    this.undoStack.push({ redo: [command], undo });
    this.redoStack.length = 0;
    this.notify(command);
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    for (const command of entry.undo) applyCommand(this.world, command);
    this.redoStack.push(entry);
    this.notify(entry.undo[0] ?? (entry.redo[0] as Command));
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    for (const command of entry.redo) applyCommand(this.world, command);
    this.undoStack.push(entry);
    this.notify(entry.redo[0] as Command);
    return true;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  subscribe(listener: (command: Command) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(command: Command): void {
    for (const listener of this.listeners) listener(command);
  }
}
