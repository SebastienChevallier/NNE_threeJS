import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Mesh, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import { CAMERA, LIGHT, MESH, TRANSFORM, World } from '@nne/core';
import { AssetCache } from '../src/assets.js';
import { Engine, type Viewport } from '../src/engine.js';

interface FakeViewport extends Viewport {
  frames: { scene: Scene; camera: PerspectiveCamera }[];
  resized: [number, number][];
  disposed: boolean;
}

function fakeViewport(): FakeViewport {
  const viewport: FakeViewport = {
    frames: [],
    resized: [],
    disposed: false,
    render(scene: Scene, camera: PerspectiveCamera) { viewport.frames.push({ scene, camera }); },
    resize(w: number, h: number) { viewport.resized.push([w, h]); },
    dispose() { viewport.disposed = true; },
  };
  return viewport;
}

const assets = () => new AssetCache({ async load() { return new Mesh() as Object3D; } });

describe('Engine', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('exposes the world, graph, scheduler and scene', () => {
    const engine = new Engine({ world, assets: assets() });
    expect(engine.world).toBe(world);
    expect(engine.graph).toBeDefined();
    expect(engine.scheduler.names().length).toBeGreaterThan(0);
    expect(engine.scene).toBeDefined();
  });

  it('registers its systems in a documented order', () => {
    const engine = new Engine({ world, assets: assets() });
    expect(engine.scheduler.names()).toEqual(['mesh', 'camera', 'light', 'transform']);
  });

  it('syncs the graph before running systems', () => {
    const engine = new Engine({ world, assets: assets() });
    const e = world.spawn('A');
    world.set(e, TRANSFORM, { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    engine.step(0.016);
    expect(engine.graph.objectOf(e)?.position.toArray()).toEqual([1, 2, 3]);
  });

  it('renders through the active camera when a viewport is given', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport });
    const cam = world.spawn('Cam');
    world.set(cam, CAMERA, { fov: 60, near: 0.1, far: 1000, active: true });
    engine.step(0.016);
    expect(viewport.frames).toHaveLength(1);
    expect(viewport.frames[0]?.scene).toBe(engine.scene);
  });

  it('does not render when there is no active camera', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport });
    engine.step(0.016);
    expect(viewport.frames).toHaveLength(0);
  });

  it('runs headlessly without a viewport', () => {
    const engine = new Engine({ world, assets: assets() });
    expect(() => engine.step(0.016)).not.toThrow();
  });

  it('drives frames through the injected scheduler', () => {
    let pending: (() => void) | undefined;
    let time = 0;
    const engine = new Engine({
      world, assets: assets(),
      now: () => time,
      schedule: (cb) => { pending = cb; return 1; },
      cancel: () => { pending = undefined; },
    });
    const spy = vi.spyOn(engine, 'step');

    engine.start();
    time = 16;
    pending?.();
    expect(spy).toHaveBeenCalledWith(0.016);
  });

  it('stops scheduling after stop()', () => {
    let pending: (() => void) | undefined;
    const engine = new Engine({
      world, assets: assets(),
      now: () => 0,
      schedule: (cb) => { pending = cb; return 1; },
      cancel: () => { pending = undefined; },
    });
    engine.start();
    engine.stop();
    expect(pending).toBeUndefined();
  });

  it('does not reschedule when a system calls stop() during the step', () => {
    let pending: (() => void) | undefined;
    let scheduled = 0;
    const engine = new Engine({
      world, assets: assets(),
      now: () => 0,
      schedule: (cb) => { pending = cb; scheduled += 1; return scheduled; },
      cancel: () => { pending = undefined; },
    });
    engine.scheduler.add('suicide', () => { engine.stop(); });
    engine.start();
    const frame = pending;
    pending = undefined;               // the frame has fired, nothing is queued
    frame?.();
    expect(pending).toBeUndefined();
    expect(scheduled).toBe(1);
  });

  it('does not reschedule when a system calls dispose() during the step', () => {
    const viewport = fakeViewport();
    let pending: (() => void) | undefined;
    let scheduled = 0;
    const engine = new Engine({
      world, assets: assets(), viewport,
      now: () => 0,
      schedule: (cb) => { pending = cb; scheduled += 1; return scheduled; },
      cancel: () => { pending = undefined; },
    });
    engine.scheduler.add('suicide', () => { engine.dispose(); });
    engine.start();
    const frame = pending;
    pending = undefined;
    frame?.();
    expect(pending).toBeUndefined();
    expect(scheduled).toBe(1);
    expect(viewport.disposed).toBe(true);
  });

  it('keeps the aspect finite when the container has zero size', () => {
    const engine = new Engine({ world, assets: assets() });
    const cam = world.spawn('Cam');
    world.set(cam, CAMERA, { fov: 60, near: 0.1, far: 1000, active: true });
    engine.resize(0, 0);
    engine.step(0.016);
    expect(Number.isFinite(engine.activeCamera()?.aspect ?? NaN)).toBe(true);
    engine.resize(800, 400);
    expect(engine.activeCamera()?.aspect).toBe(2);
  });

  it('clamps a long frame so physics-free logic does not jump', () => {
    let pending: (() => void) | undefined;
    let time = 0;
    const engine = new Engine({
      world, assets: assets(),
      now: () => time,
      schedule: (cb) => { pending = cb; return 1; },
      cancel: () => {},
    });
    const spy = vi.spyOn(engine, 'step');
    engine.start();
    time = 5000;                       // tab was backgrounded for five seconds
    pending?.();
    expect(spy).toHaveBeenCalledWith(0.1);
  });

  it('forwards resize to the viewport', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport });
    engine.resize(800, 600);
    expect(viewport.resized).toEqual([[800, 600]]);
  });

  it('updates the active camera aspect on resize', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport });
    const cam = world.spawn('Cam');
    world.set(cam, CAMERA, { fov: 60, near: 0.1, far: 1000, active: true });
    engine.step(0.016);
    engine.resize(800, 400);
    expect(engine.activeCamera()?.aspect).toBe(2);
  });

  it('gives a camera created after a resize the right aspect on the next step', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport });
    engine.resize(800, 400);
    const cam = world.spawn('Cam');
    world.set(cam, CAMERA, { fov: 60, near: 0.1, far: 1000, active: true });
    engine.step(0.016);
    expect(engine.activeCamera()?.aspect).toBe(2);
  });

  it('disposes the viewport and stops the loop', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport, now: () => 0, schedule: () => 1, cancel: () => {} });
    engine.start();
    engine.dispose();
    expect(viewport.disposed).toBe(true);
  });

  it('renders lights and meshes together without throwing', () => {
    const engine = new Engine({ world, assets: assets() });
    const cam = world.spawn('Cam');
    world.set(cam, CAMERA, { fov: 60, near: 0.1, far: 1000, active: true });
    const light = world.spawn('L');
    world.set(light, LIGHT, { type: 'ambient', color: '#ffffff', intensity: 1 });
    const mesh = world.spawn('M');
    world.set(mesh, MESH, { asset: 'a.glb', castShadow: true });
    world.set(mesh, TRANSFORM, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(() => { engine.step(0.016); engine.step(0.016); }).not.toThrow();
  });
});
