import { Object3D } from 'three';
import type { EntityId, World } from '@nne/core';

/**
 * Mirrors the ECS hierarchy into a three.js object tree.
 *
 * The world is the source of truth: `sync` only ever reads it and writes the
 * graph, never the other way round.
 */
export class SceneGraph {
  private readonly objects = new Map<EntityId, Object3D>();

  constructor(private readonly root: Object3D) {}

  objectOf(entity: EntityId): Object3D | undefined {
    return this.objects.get(entity);
  }

  entities(): EntityId[] {
    return [...this.objects.keys()].sort((a, b) => a - b);
  }

  /** Replaces the object mirroring an entity, e.g. once its .glb has loaded. */
  attach(entity: EntityId, object: Object3D): void {
    const previous = this.objects.get(entity);
    if (previous) {
      previous.removeFromParent();
      // Carry the children over, so a loaded asset does not orphan child entities.
      for (const child of [...previous.children]) object.add(child);
    }
    object.userData.entity = entity;
    this.objects.set(entity, object);
  }

  detach(entity: EntityId): void {
    const object = this.objects.get(entity);
    if (!object) return;
    object.removeFromParent();
    this.objects.delete(entity);
  }

  sync(world: World): void {
    // 1. Drop objects whose entity is gone.
    for (const entity of [...this.objects.keys()]) {
      if (!world.alive(entity)) this.detach(entity);
    }

    // 2. Create a placeholder for every entity we do not track yet.
    for (const entity of world.entities()) {
      if (!this.objects.has(entity)) {
        const object = new Object3D();
        object.userData.entity = entity;
        this.objects.set(entity, object);
      }
    }

    // 3. Realign parenting. Done after every object exists, so a child whose
    //    parent was created in this same pass still finds it.
    for (const entity of world.entities()) {
      const object = this.objects.get(entity) as Object3D;
      object.name = world.getName(entity);

      const parentId = world.getParent(entity);
      const target = parentId === null ? this.root : this.objects.get(parentId) as Object3D;
      if (object.parent !== target) target.add(object);
    }
  }
}
