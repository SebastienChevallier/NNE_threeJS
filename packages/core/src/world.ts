import type { EntityId } from './types.js';

/**
 * Holds every entity, its metadata and its components.
 * Deliberately free of any rendering concern: `core` never imports three.js.
 */
export class World {
  private nextId: EntityId = 1;
  private readonly live = new Set<EntityId>();
  private readonly names = new Map<EntityId, string>();
  private readonly parents = new Map<EntityId, EntityId | null>();

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
  spawnWithId(id: EntityId, name: string, parent: EntityId | null): void {
    if (this.live.has(id)) {
      throw new Error(`entity ${id} is already live`);
    }
    if (parent !== null) this.assertAlive(parent);
    this.live.add(id);
    this.names.set(id, name);
    this.parents.set(id, parent);
    if (id >= this.nextId) this.nextId = id + 1;
  }

  despawn(entity: EntityId): void {
    if (!this.live.has(entity)) return;
    // Depth-first, children before parents, so no orphan is ever left behind.
    for (const id of this.subtree(entity).reverse()) {
      this.live.delete(id);
      this.names.delete(id);
      this.parents.delete(id);
    }
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

  getParent(entity: EntityId): EntityId | null {
    this.assertAlive(entity);
    return this.parents.get(entity) ?? null;
  }

  setParent(entity: EntityId, parent: EntityId | null): void {
    this.assertAlive(entity);
    if (parent !== null) {
      this.assertAlive(parent);
      if (this.subtree(entity).includes(parent)) {
        throw new Error(`parenting ${entity} to ${parent} would create a cycle`);
      }
    }
    this.parents.set(entity, parent);
  }

  children(entity: EntityId): EntityId[] {
    this.assertAlive(entity);
    return this.entities().filter((id) => this.parents.get(id) === entity);
  }

  /** The entity followed by all its descendants, breadth-first. */
  subtree(entity: EntityId): EntityId[] {
    this.assertAlive(entity);
    const out: EntityId[] = [entity];
    for (let i = 0; i < out.length; i++) {
      out.push(...this.children(out[i] as EntityId));
    }
    return out;
  }

  protected assertAlive(entity: EntityId): void {
    if (!this.live.has(entity)) {
      throw new Error(`unknown entity ${entity}`);
    }
  }
}
