import { beforeEach, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MESH, TRANSFORM, type Command, type SceneFile } from '@nne/core';
import { EditorSession } from '../src/session.js';
import { dropAsset, groundDropPoint, type Ray } from '../src/model/drop.js';
import type { AssetSummary } from '../src/types.js';

const asset: AssetSummary = {
  path: 'props/PRP_Chair_01.glb',
  category: 'PRP',
  url: '/cache/assets/props/PRP_Chair_01.glb',
  thumbnailUrl: null,
  triangles: 12,
};

const empty: SceneFile = { version: 1, name: 'S', entities: [] };

/** A ray as the raycaster gives it: an origin and a normalized direction. */
function ray(origin: [number, number, number], direction: [number, number, number]): Ray {
  return {
    origin: new Vector3(...origin),
    direction: new Vector3(...direction).normalize(),
  };
}

describe('groundDropPoint', () => {
  it('lands where the ray meets the ground plane', () => {
    const point = groundDropPoint(ray([0, 10, 0], [0, -1, 0]));
    expect(point).toEqual([0, 0, 0]);
  });

  it('lands at the right spot for an angled ray', () => {
    const point = groundDropPoint(ray([0, 10, 0], [1, -1, 0]));
    expect(point[0]).toBeCloseTo(10);
    expect(point[1]).toBeCloseTo(0);
    expect(point[2]).toBeCloseTo(0);
  });

  it('falls back in front of the camera when the ray points at the sky', () => {
    // Aiming at the horizon or above it never meets the ground. Dropping the
    // object at the origin would be baffling; putting it a fixed distance ahead
    // is what the user means.
    const point = groundDropPoint(ray([0, 2, 0], [0, 1, 0]), 10);
    expect(point).toEqual([0, 12, 0]);
  });

  it('falls back for a ray exactly parallel to the ground', () => {
    const point = groundDropPoint(ray([0, 2, 0], [1, 0, 0]), 10);
    expect(point[0]).toBeCloseTo(10);
    expect(point[1]).toBeCloseTo(2);
  });

  it('falls back when the ground is behind the camera', () => {
    // Camera below the plane looking further down: the plane is behind it, so
    // the intersection distance is negative and must not be used.
    const point = groundDropPoint(ray([0, -5, 0], [0, -1, 0]), 10);
    expect(point[1]).toBeCloseTo(-15);
  });

  it('lands on the ground for a camera below it looking up', () => {
    const point = groundDropPoint(ray([0, -5, 0], [0, 1, 0]));
    expect(point[1]).toBeCloseTo(0);
  });
});

describe('dropAsset', () => {
  let session: EditorSession;
  let dispatched: Command[];

  beforeEach(() => {
    session = new EditorSession();
    session.loadScene(empty);
    dispatched = [];
    const original = session.dispatch.bind(session);
    session.dispatch = (command: Command) => {
      dispatched.push(command);
      original(command);
    };
  });

  it('creates an entity named after the asset file', () => {
    const entity = dropAsset(session, asset, [1, 0, 2]);
    expect(session.world.getName(entity)).toBe('PRP_Chair_01');
  });

  it('gives it a Transform at the drop point', () => {
    const entity = dropAsset(session, asset, [1, 0, 2]);
    expect(session.world.peek(entity, TRANSFORM)).toMatchObject({
      position: [1, 0, 2],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
  });

  it('gives it a Mesh pointing at the asset', () => {
    const entity = dropAsset(session, asset, [0, 0, 0]);
    expect(session.world.peek(entity, MESH)).toMatchObject({
      asset: 'props/PRP_Chair_01.glb',
    });
  });

  it('goes entirely through commands, so the drop can be undone', () => {
    const entity = dropAsset(session, asset, [0, 0, 0]);
    expect(dispatched.every((c) => typeof c.kind === 'string')).toBe(true);

    // Three commands, so three undos. Documented in the plan as accepted for
    // V1: batching them would be a change to core's command layer.
    expect(dispatched).toHaveLength(3);
    for (let i = 0; i < 3; i++) session.undo();
    expect(session.world.alive(entity)).toBe(false);
  });

  it('drops two assets as two independent entities', () => {
    const first = dropAsset(session, asset, [0, 0, 0]);
    const second = dropAsset(session, asset, [1, 0, 0]);
    expect(second).not.toBe(first);
    expect(session.world.entities()).toHaveLength(2);
  });

  it('strips only the extension, not the rest of the name', () => {
    const dotted = { ...asset, path: 'props/PRP_Chair.v2.glb' };
    const entity = dropAsset(session, dotted, [0, 0, 0]);
    expect(session.world.getName(entity)).toBe('PRP_Chair.v2');
  });

  it('produces components the registry accepts', () => {
    // If the defaults were wrong the scene would only fail at save time, on the
    // server, which is a long way from the drop that caused it.
    const entity = dropAsset(session, asset, [0, 0, 0]);
    for (const type of [TRANSFORM, MESH]) {
      const data = session.world.get(entity, type);
      expect(session.registry.validate(type, data)).toEqual([]);
    }
  });
});
