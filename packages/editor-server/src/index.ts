export { startEditorServer, type RunningServer, type StartOptions } from './main.js';
export { createServer, type EditorServer, type ServerOptions } from './server.js';
export { createNotifier, type Notifier } from './notifier.js';
export { createWatcher, type ProjectWatcher, type WatcherOptions } from './watcher.js';
export { ProjectStore, HttpError } from './project-store.js';
export { AssetPipeline, type ScanErrorHandler } from './assets/pipeline.js';
export {
  createGltfTransformOptimizer, readMetadata,
  type AssetOptimizer, type OptimizeRequest,
} from './assets/optimizer.js';
export {
  ASSET_PREFIXES, STANDARD_ANIMATIONS, TEXTURE_LIMITS, categoryOf, validateAssetPath,
} from './assets/naming.js';
export {
  build, referencedAssets,
  type BuildOptions, type BuildRequest, type BuildResult, type PlayerBundler,
} from './build.js';
export { lintAssets } from './lint-assets.js';
export {
  containedJoin, isValidSceneName, resolveProject, toPosix, type ProjectPaths,
} from './paths.js';
export { writeAtomic } from './atomic.js';
export {
  PROJECT_VERSION,
  type AssetCategory, type AssetEntry, type AssetMetadata,
  type ProjectEvent, type ProjectFile, type Vec3,
} from './types.js';
