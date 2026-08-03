import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { World } from '@nne/core';
import type { TransformData } from '../src/types.js';

describe('runtime toolchain', () => {
  it('constructs a three Object3D in node without a GPU', () => {
    const object = new Object3D();
    object.position.set(1, 2, 3);
    expect(object.position.toArray()).toEqual([1, 2, 3]);
  });

  it('resolves @nne/core from the workspace', () => {
    expect(new World().spawn()).toBe(1);
  });

  it('types component data', () => {
    const t: TransformData = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    expect(t.scale).toEqual([1, 1, 1]);
  });
});
