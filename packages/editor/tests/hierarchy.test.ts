import { describe, expect, it } from 'vitest';
import { World } from '@nne/core';
import { buildHierarchy, canReparent } from '../src/model/hierarchy.js';

/** a -> b -> c, plus a standalone d. */
function tree(): World {
  const world = new World();
  const a = world.spawn('A');
  const b = world.spawn('B', a);
  world.spawn('C', b);
  world.spawn('D');
  return world;
}

describe('buildHierarchy', () => {
  it('nests children under their parent', () => {
    expect(buildHierarchy(tree())).toEqual([
      {
        id: 1,
        name: 'A',
        children: [{ id: 2, name: 'B', children: [{ id: 3, name: 'C', children: [] }] }],
      },
      { id: 4, name: 'D', children: [] },
    ]);
  });

  it('returns an empty list for an empty world', () => {
    expect(buildHierarchy(new World())).toEqual([]);
  });

  it('orders siblings by id, so the tree does not jump around', () => {
    const world = new World();
    const parent = world.spawn('P');
    world.spawn('Z', parent);
    world.spawn('A', parent);
    expect(buildHierarchy(world)[0]?.children.map((c) => c.name)).toEqual(['Z', 'A']);
  });

  it('handles a deep chain without losing anyone', () => {
    const world = new World();
    let parent: number | null = null;
    for (let i = 0; i < 50; i++) parent = world.spawn(`E${i}`, parent);

    let node = buildHierarchy(world)[0];
    let depth = 1;
    while (node?.children[0]) {
      node = node.children[0];
      depth++;
    }
    expect(depth).toBe(50);
  });

  it('places every entity exactly once', () => {
    const world = tree();
    const seen: number[] = [];
    const walk = (nodes: ReturnType<typeof buildHierarchy>): void => {
      for (const node of nodes) {
        seen.push(node.id);
        walk(node.children);
      }
    };
    walk(buildHierarchy(world));
    expect(seen.sort((a, b) => a - b)).toEqual(world.entities());
  });
});

describe('canReparent', () => {
  it('allows an unrelated entity', () => {
    expect(canReparent(tree(), 4, 1)).toBe(true);
  });

  it('allows detaching to the root', () => {
    expect(canReparent(tree(), 3, null)).toBe(true);
  });

  it('refuses parenting an entity to itself', () => {
    expect(canReparent(tree(), 1, 1)).toBe(false);
  });

  it('refuses parenting an entity to its own child', () => {
    expect(canReparent(tree(), 1, 2)).toBe(false);
  });

  it('refuses parenting an entity to a deeper descendant', () => {
    expect(canReparent(tree(), 1, 3)).toBe(false);
  });

  it('refuses a dead entity on either side', () => {
    const world = tree();
    expect(canReparent(world, 99, 1)).toBe(false);
    expect(canReparent(world, 1, 99)).toBe(false);
  });

  it('allows a no-op reparent to the current parent', () => {
    expect(canReparent(tree(), 2, 1)).toBe(true);
  });

  it('agrees with what the World actually accepts', () => {
    // The whole point of this function is to answer the question the World
    // answers with an exception. If the two ever disagree, the Hierarchy emits
    // a command that throws mid-session.
    const world = tree();
    for (const entity of world.entities()) {
      for (const parent of [...world.entities(), null]) {
        const predicted = canReparent(world, entity, parent);
        let accepted = true;
        try {
          world.setParent(entity, parent);
        } catch {
          accepted = false;
        }
        expect(predicted, `${entity} -> ${String(parent)}`).toBe(accepted);
        if (accepted) world.setParent(entity, null);
      }
    }
  });
});
