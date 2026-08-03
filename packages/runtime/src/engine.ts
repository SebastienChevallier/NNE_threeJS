import { Object3D, type PerspectiveCamera, Scene } from 'three';
import { Scheduler, type World } from '@nne/core';
import type { AssetCache } from './assets.js';
import { SceneGraph } from './scene-graph.js';
import { createCameraSystem, type CameraSystem } from './systems/camera-system.js';
import { createLightSystem } from './systems/light-system.js';
import { createMeshSystem } from './systems/mesh-system.js';
import { createTransformSystem } from './systems/transform-system.js';

/** Everything that needs a real GPU context, behind one narrow interface. */
export interface Viewport {
  render(scene: Scene, camera: PerspectiveCamera): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface EngineOptions {
  world: World;
  assets: AssetCache;
  /** Omit to run headlessly, e.g. in tests. */
  viewport?: Viewport;
  now?: () => number;
  schedule?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
}

/** A frame longer than this is clamped, so a backgrounded tab cannot jump state. */
const MAX_DELTA_SECONDS = 0.1;

export class Engine {
  readonly world: World;
  readonly graph: SceneGraph;
  readonly scheduler = new Scheduler();
  readonly scene = new Scene();

  private readonly assets: AssetCache;
  private readonly viewport: Viewport | undefined;
  private readonly camera: CameraSystem;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void) => number;
  private readonly cancel: (handle: number) => void;

  private handle: number | undefined;
  private lastTime = 0;
  private width = 1;
  private height = 1;

  constructor(options: EngineOptions) {
    this.world = options.world;
    this.assets = options.assets;
    this.viewport = options.viewport;
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = options.cancel ?? ((h) => cancelAnimationFrame(h));

    const root = new Object3D();
    root.name = 'entities';
    this.scene.add(root);
    this.graph = new SceneGraph(root);

    this.camera = createCameraSystem(this.graph);

    // Order matters and is deliberate: meshes and cameras and lights may all
    // attach new objects, and transform runs last so it writes onto whatever
    // object each entity ended the frame with.
    this.scheduler.add('mesh', createMeshSystem(this.graph, this.assets));
    this.scheduler.add('camera', this.camera);
    this.scheduler.add('light', createLightSystem(this.graph));
    this.scheduler.add('transform', createTransformSystem(this.graph));
  }

  activeCamera(): PerspectiveCamera | undefined {
    return this.camera.active();
  }

  step(dt: number): void {
    this.graph.sync(this.world);
    this.scheduler.run(this.world, dt);

    const camera = this.camera.active();
    if (camera) {
      // A camera created after the last resize would otherwise keep aspect 1
      // and render distorted until the window happens to be resized again.
      // Guarded, so we do not rebuild the projection matrix every frame.
      this.applyAspect(camera);
      this.viewport?.render(this.scene, camera);
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.viewport?.resize(width, height);
    const camera = this.camera.active();
    if (camera) this.applyAspect(camera);
  }

  start(): void {
    if (this.handle !== undefined) return;
    this.lastTime = this.now();
    const frame = (): void => {
      const time = this.now();
      const dt = Math.min((time - this.lastTime) / 1000, MAX_DELTA_SECONDS);
      this.lastTime = time;
      this.step(dt);
      this.handle = this.schedule(frame);
    };
    this.handle = this.schedule(frame);
  }

  stop(): void {
    if (this.handle === undefined) return;
    this.cancel(this.handle);
    this.handle = undefined;
  }

  dispose(): void {
    this.stop();
    this.viewport?.dispose();
  }

  private applyAspect(camera: PerspectiveCamera): void {
    const aspect = this.width / this.height;
    if (camera.aspect === aspect) return;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
}
