import { describe, expect, it } from 'vitest';
import { framingFor, type Bounds } from '../src/thumbnails.js';

const box = (min: [number, number, number], max: [number, number, number]): Bounds =>
  ({ min, max });

describe('framingFor', () => {
  it('looks at the centre of the box, not at the origin', () => {
    // The project convention puts an asset's origin at its base, on the floor.
    // Aiming at the origin would frame the feet of every character.
    const framing = framingFor(box([-1, 0, -1], [1, 2, 1]));
    expect(framing.target).toEqual([0, 1, 0]);
  });

  it('backs off further for a bigger object', () => {
    const small = framingFor(box([0, 0, 0], [1, 1, 1]));
    const large = framingFor(box([0, 0, 0], [10, 10, 10]));
    const distance = (f: { position: number[]; target: number[] }): number =>
      Math.hypot(...f.position.map((p, i) => p - (f.target[i] as number)));

    expect(distance(large)).toBeGreaterThan(distance(small));
  });

  it('frames on the largest dimension, so a long object still fits', () => {
    const flat = framingFor(box([0, 0, 0], [10, 0.1, 0.1]));
    const cube = framingFor(box([0, 0, 0], [10, 10, 10]));
    const distance = (f: { position: number[]; target: number[] }): number =>
      Math.hypot(...f.position.map((p, i) => p - (f.target[i] as number)));

    // Both are 10 units across at their widest, so both need a similar pull-back.
    expect(distance(flat)).toBeCloseTo(distance(cube), 0);
  });

  it('produces finite numbers for a degenerate box', () => {
    // An asset with no geometry reports a zero box. A distance of 0 would put
    // the camera inside the object and a division by the size would produce
    // NaN, which silently blanks every thumbnail after it.
    const framing = framingFor(box([0, 0, 0], [0, 0, 0]));
    for (const value of [...framing.position, ...framing.target]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(framing.position).not.toEqual(framing.target);
  });

  it('handles a box that does not straddle the origin', () => {
    const framing = framingFor(box([100, 0, 100], [102, 2, 102]));
    expect(framing.target).toEqual([101, 1, 101]);
  });

  it('handles negative coordinates', () => {
    const framing = framingFor(box([-10, -4, -10], [-8, -2, -8]));
    expect(framing.target).toEqual([-9, -3, -9]);
  });

  it('places the camera above and to the side, not axis-aligned', () => {
    // A straight-on view of a box shows a rectangle; a three-quarter view reads
    // as an object.
    const framing = framingFor(box([-1, 0, -1], [1, 2, 1]));
    const [x, y, z] = framing.position;
    expect(x).not.toBeCloseTo(framing.target[0]);
    expect(y).toBeGreaterThan(framing.target[1]);
    expect(z).not.toBeCloseTo(framing.target[2]);
  });

  it('is deterministic, so a re-render produces the same image', () => {
    const bounds = box([-1, 0, -1], [1, 2, 1]);
    expect(framingFor(bounds)).toEqual(framingFor(bounds));
  });
});
