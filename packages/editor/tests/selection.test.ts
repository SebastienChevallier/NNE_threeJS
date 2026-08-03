import { describe, expect, it } from 'vitest';
import { Mesh, Object3D } from 'three';
import { entityOf, pickEntity, type Intersection } from '../src/viewport/selection.js';

/** An object tree mirroring one entity: a loaded .glb is a subtree, not a leaf. */
function loadedAsset(entity: number): Object3D {
  const root = new Object3D();
  root.userData['entity'] = entity;
  const body = new Mesh();
  const armrest = new Mesh();
  body.add(armrest);
  root.add(body);
  return root;
}

describe('entityOf', () => {
  it('finds the entity on the object itself', () => {
    const object = new Object3D();
    object.userData['entity'] = 7;
    expect(entityOf(object)).toBe(7);
  });

  it('walks up to the entity root from a nested mesh', () => {
    // Clicking a chair must select the chair, not its armrest. A raycast hits a
    // leaf of the loaded subtree, and only the subtree's root carries the id.
    const root = loadedAsset(7);
    const armrest = root.children[0]?.children[0] as Object3D;
    expect(entityOf(armrest)).toBe(7);
  });

  it('returns undefined when nothing in the chain is an entity', () => {
    const root = new Object3D();
    const child = new Object3D();
    root.add(child);
    expect(entityOf(child)).toBeUndefined();
  });

  it('stops at the nearest entity when entities are nested', () => {
    const parent = loadedAsset(1);
    const child = loadedAsset(2);
    parent.add(child);
    const childMesh = child.children[0] as Object3D;
    expect(entityOf(childMesh)).toBe(2);
  });

  it('ignores a non-numeric entity marker', () => {
    const object = new Object3D();
    object.userData['entity'] = 'seven';
    expect(entityOf(object)).toBeUndefined();
  });
});

describe('pickEntity', () => {
  it('returns the entity of the nearest hit', () => {
    const near = loadedAsset(2);
    const far = loadedAsset(3);
    const hits: Intersection[] = [
      { distance: 1, object: near.children[0] as Object3D },
      { distance: 5, object: far.children[0] as Object3D },
    ];
    expect(pickEntity(hits)).toBe(2);
  });

  it('skips a hit that belongs to no entity, such as the grid', () => {
    // The edit layer is in the same scene; a click on the grid must fall
    // through to whatever is behind it rather than clearing the selection.
    const entity = loadedAsset(4);
    const hits: Intersection[] = [
      { distance: 1, object: new Object3D() },
      { distance: 5, object: entity.children[0] as Object3D },
    ];
    expect(pickEntity(hits)).toBe(4);
  });

  it('returns undefined when nothing was hit', () => {
    expect(pickEntity([])).toBeUndefined();
  });

  it('returns undefined when no hit belongs to an entity', () => {
    expect(pickEntity([{ distance: 1, object: new Object3D() }])).toBeUndefined();
  });

  it('does not assume the hits are sorted', () => {
    const near = loadedAsset(2);
    const far = loadedAsset(3);
    const hits: Intersection[] = [
      { distance: 9, object: far.children[0] as Object3D },
      { distance: 1, object: near.children[0] as Object3D },
    ];
    expect(pickEntity(hits)).toBe(2);
  });
});
