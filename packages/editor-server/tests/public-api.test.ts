import { describe, expect, it } from 'vitest';
import * as server from '../src/index.js';

describe('public API', () => {
  it('exports every documented symbol', () => {
    for (const name of [
      'startEditorServer', 'createServer', 'createNotifier', 'createWatcher',
      'ProjectStore', 'HttpError', 'AssetPipeline', 'createGltfTransformOptimizer',
      'readMetadata', 'categoryOf', 'validateAssetPath', 'build', 'referencedAssets',
      'lintAssets', 'resolveProject', 'containedJoin', 'writeAtomic',
      'ASSET_PREFIXES', 'TEXTURE_LIMITS', 'STANDARD_ANIMATIONS',
      'isValidSceneName', 'toPosix', 'PROJECT_VERSION',
    ]) {
      expect(server).toHaveProperty(name);
    }
  });
});
