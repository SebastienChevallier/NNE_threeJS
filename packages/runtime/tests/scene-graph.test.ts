import { beforeEach, describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { World } from '@nne/core';
import { SceneGraph } from '../src/scene-graph.js';

describe('SceneGraph', () => {
  let root: Object3D;
  let graph: SceneGraph;
  let world: World;

  beforeEach(() => {
    root = new Object3D();
    graph = new SceneGraph(root);
    world = new World();
  });

  it('creates an object for each live entity', () => {
    const a = world.spawn('A');
    graph.sync(world);
    expect(graph.objectOf(a)).toBeInstanceOf(Object3D);
  });

  it('parents root entities under the graph root', () => {
    const a = world.spawn('A');
    graph.sync(world);
    expect(graph.objectOf(a)?.parent).toBe(root);
  });

  it('mirrors the world hierarchy', () => {
    const parent = world.spawn('Parent');
    const child = world.spawn('Child', parent);
    graph.sync(world);
    expect(graph.objectOf(child)?.parent).toBe(graph.objectOf(parent));
  });

  it('reparents when the world reparents', () => {
    const p1 = world.spawn('P1');
    const p2 = world.spawn('P2');
    const child = world.spawn('C', p1);
    graph.sync(world);
    world.setParent(child, p2);
    graph.sync(world);
    expect(graph.objectOf(child)?.parent).toBe(graph.objectOf(p2));
    expect(graph.objectOf(p1)?.children).toHaveLength(0);
  });

  it('removes objects for despawned entities', () => {
    const a = world.spawn('A');
    graph.sync(world);
    world.despawn(a);
    graph.sync(world);
    expect(graph.objectOf(a)).toBeUndefined();
    expect(root.children).toHaveLength(0);
  });

  it('removes a whole despawned subtree', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    graph.sync(world);
    world.despawn(a);
    graph.sync(world);
    expect(graph.objectOf(a)).toBeUndefined();
    expect(graph.objectOf(b)).toBeUndefined();
  });

  it('keeps the same object across syncs', () => {
    const a = world.spawn('A');
    graph.sync(world);
    const first = graph.objectOf(a);
    graph.sync(world);
    expect(graph.objectOf(a)).toBe(first);
  });

  it('tags each object with its entity id', () => {
    const a = world.spawn('A');
    graph.sync(world);
    expect(graph.objectOf(a)?.userData.entity).toBe(a);
  });

  it('names each object after its entity, for debugging', () => {
    const a = world.spawn('Chaise');
    graph.sync(world);
    expect(graph.objectOf(a)?.name).toBe('Chaise');
  });

  it('attach replaces the existing object and keeps the parent link', () => {
    const parent = world.spawn('P');
    const child = world.spawn('C', parent);
    graph.sync(world);
    const replacement = new Object3D();
    graph.attach(child, replacement);
    graph.sync(world);
    expect(graph.objectOf(child)).toBe(replacement);
    expect(replacement.parent).toBe(graph.objectOf(parent));
  });

  it('attach parents the replacement immediately, without another sync', () => {
    const parent = world.spawn('P');
    const child = world.spawn('C', parent);
    graph.sync(world);
    const replacement = new Object3D();
    graph.attach(child, replacement);
    expect(replacement.parent).toBe(graph.objectOf(parent));
  });

  it('attach parents a root replacement under the graph root immediately', () => {
    const a = world.spawn('A');
    graph.sync(world);
    const replacement = new Object3D();
    graph.attach(a, replacement);
    expect(replacement.parent).toBe(root);
    expect(root.children).toEqual([replacement]);
  });

  it('detach removes an object from the graph and its parent', () => {
    const a = world.spawn('A');
    graph.sync(world);
    graph.detach(a);
    expect(graph.objectOf(a)).toBeUndefined();
    expect(root.children).toHaveLength(0);
  });

  it('lists tracked entities ascending', () => {
    const a = world.spawn('A');
    const b = world.spawn('B');
    graph.sync(world);
    expect(graph.entities()).toEqual([a, b]);
  });

  it('parents a child created before its parent in the same sync', () => {
    const parent = world.spawn('Parent');
    const child = world.spawn('Child', parent);
    graph.sync(world);
    expect(graph.objectOf(child)?.parent).toBe(graph.objectOf(parent));
  });
});
