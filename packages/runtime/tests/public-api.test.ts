import { describe, expect, it } from 'vitest';
import * as runtime from '../src/index.js';

describe('public API', () => {
  it('exports every documented symbol', () => {
    for (const name of [
      'Engine', 'SceneGraph', 'AssetCache', 'createGltfSource',
      'createWebGLViewport', 'createPlayer', 'loadSceneIntoWorld',
      'applyTransform', 'createLight', 'applyLight',
      'createCameraSystem', 'createLightSystem', 'createMeshSystem', 'createTransformSystem',
    ]) {
      expect(runtime).toHaveProperty(name);
    }
  });
});
