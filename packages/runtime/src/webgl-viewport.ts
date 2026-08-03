import { PCFSoftShadowMap, type PerspectiveCamera, type Scene, WebGLRenderer } from 'three';
import type { Viewport } from './engine.js';

/**
 * The only place a GPU context is created. Everything else in this package runs
 * headlessly, which is what makes the systems testable in node.
 */
export function createWebGLViewport(canvas: HTMLCanvasElement): Viewport {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  return {
    render(scene: Scene, camera: PerspectiveCamera): void {
      renderer.render(scene, camera);
    },
    resize(width: number, height: number): void {
      renderer.setSize(width, height, false);
    },
    dispose(): void {
      renderer.dispose();
    },
  };
}
