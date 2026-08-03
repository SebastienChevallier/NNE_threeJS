import type { EntityId } from './types.js';

/**
 * Holds every entity, its metadata and its components.
 * Deliberately free of any rendering concern: `core` never imports three.js.
 */
export class World {
  private nextId: EntityId = 1;
  private readonly live = new Set<EntityId>();
  private readonly names = new Map<EntityId, string>();

  /** Reserves the next id without creating an entity. Used by commands. */
  allocateId(): EntityId {
    return this.nextId++;
  }

  spawn(name?: string, parent: EntityId | null = null): EntityId {
    const id = this.allocateId();
    this.spawnWithId(id, name ?? `Entity ${id}`, parent);
    return id;
  }

  /** Creates an entity at a caller-chosen id. Used by scene loading and undo. */
  spawnWithId(id: EntityId, name: string, _parent: EntityId | null): void {
    if (this.live.has(id)) {
      throw new Error(`entity ${id} is already live`);
    }
    this.live.add(id);
    this.names.set(id, name);
    if (id >= this.nextId) this.nextId = id + 1;
  }

  despawn(entity: EntityId): void {
    this.live.delete(entity);
    this.names.delete(entity);
  }

  alive(entity: EntityId): boolean {
    return this.live.has(entity);
  }

  entities(): EntityId[] {
    return [...this.live].sort((a, b) => a - b);
  }

  getName(entity: EntityId): string {
    this.assertAlive(entity);
    return this.names.get(entity) as string;
  }

  setName(entity: EntityId, name: string): void {
    this.assertAlive(entity);
    this.names.set(entity, name);
  }

  protected assertAlive(entity: EntityId): void {
    if (!this.live.has(entity)) {
      throw new Error(`unknown entity ${entity}`);
    }
  }
}
