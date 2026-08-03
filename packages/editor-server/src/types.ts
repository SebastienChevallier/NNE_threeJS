/** A position triple, in metres. Redefined here so the server never pulls in `three`. */
export type Vec3 = [number, number, number];

/** The project manifest format. Bumped only on a breaking layout change. */
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  name: string;
  version: number;
  /** Scene opened by the player and by the editor on boot. */
  startScene: string | null;
}

/** The four asset categories the naming convention allows. */
export type AssetCategory = 'CHR' | 'PRP' | 'ENV' | 'UI';

/** Extracted once at import, so the editor never parses a .glb to show a list. */
export interface AssetMetadata {
  bounds: { min: Vec3; max: Vec3 };
  animations: string[];
  triangles: number;
}

/** One optimized asset, as recorded in the cache manifest. */
export interface AssetEntry {
  /** Path relative to `assets/`, forward-slashed, e.g. "props/PRP_Chair_01.glb". */
  path: string;
  category: AssetCategory;
  /** Path relative to `.cache/`, what the runtime actually loads. */
  cached: string;
  /** Path relative to `.cache/`, or null until the editor uploads one. */
  thumbnail: string | null;
  metadata: AssetMetadata;
  /** Source mtime and size, so an unchanged file is not re-optimized. */
  sourceMtimeMs: number;
  sourceSize: number;
}

/** What the watcher broadcasts over the WebSocket. */
export type ProjectEvent =
  | { type: 'asset-changed'; path: string; entry: AssetEntry }
  | { type: 'asset-removed'; path: string }
  | { type: 'asset-failed'; path: string; message: string }
  | { type: 'scene-changed'; name: string };
