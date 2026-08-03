import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '../atomic.js';
import { containedJoin, toPosix, type ProjectPaths } from '../paths.js';
import { HttpError } from '../project-store.js';
import type { AssetEntry } from '../types.js';
import { categoryOf, validateAssetPath } from './naming.js';
import type { AssetOptimizer } from './optimizer.js';

/** Called per failing asset during a scan, so one bad file does not stop the rest. */
export type ScanErrorHandler = (path: string, message: string) => void;

const MANIFEST = 'assets.json';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Owns `.cache/`: optimizes sources into it, and remembers what it optimized.
 *
 * The manifest is pure derived state. Deleting `.cache/` costs a re-optimization
 * pass and nothing else, which is what makes the cache safe to gitignore.
 */
export class AssetPipeline {
  private manifest: Map<string, AssetEntry> | undefined;

  constructor(
    private readonly paths: ProjectPaths,
    private readonly optimizer: AssetOptimizer,
  ) {}

  async entries(): Promise<AssetEntry[]> {
    const manifest = await this.load();
    return [...manifest.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async entry(path: string): Promise<AssetEntry | undefined> {
    return (await this.load()).get(toPosix(path));
  }

  /** Optimizes one asset and records it, replacing any previous entry. */
  async importAsset(relPath: string): Promise<AssetEntry> {
    const path = toPosix(relPath);
    const problems = validateAssetPath(path);
    if (problems.length > 0) {
      throw new HttpError(
        400,
        `asset "${path}" breaks the naming convention:\n  ${problems.join('\n  ')}`,
      );
    }
    const category = categoryOf(path);
    if (category === null) throw new HttpError(400, `asset "${path}" has no category`);

    const source = containedJoin(this.paths.assets, path);
    let info;
    try {
      info = await stat(source);
    } catch (error) {
      if (isMissing(error)) throw new HttpError(404, `no asset at "${path}"`);
      throw error;
    }

    const cached = `assets/${path}`;
    const metadata = await this.optimizer.run({
      source,
      target: containedJoin(this.paths.cache, cached),
      category,
    });

    const manifest = await this.load();
    const entry: AssetEntry = {
      path,
      category,
      cached,
      // A re-import must not lose a thumbnail the editor already rendered.
      thumbnail: manifest.get(path)?.thumbnail ?? null,
      metadata,
      sourceMtimeMs: info.mtimeMs,
      sourceSize: info.size,
    };
    manifest.set(path, entry);
    await this.save();
    return entry;
  }

  async removeAsset(relPath: string): Promise<void> {
    const path = toPosix(relPath);
    const manifest = await this.load();
    const entry = manifest.get(path);
    if (!entry) return;

    manifest.delete(path);
    await rm(containedJoin(this.paths.cache, entry.cached), { force: true });
    if (entry.thumbnail) {
      await rm(containedJoin(this.paths.cache, entry.thumbnail), { force: true });
    }
    await this.save();
  }

  /** Brings the cache in line with `assets/`, doing the least work it can. */
  async scanAll(onError?: ScanErrorHandler): Promise<AssetEntry[]> {
    const manifest = await this.load();
    const found = await this.walk();
    let dirty = false;

    for (const path of found) {
      // The linter runs on every scan, not only on upload: a file copied into
      // assets/ by hand goes through the same gate as one that was uploaded.
      const problems = validateAssetPath(path);
      if (problems.length > 0) {
        onError?.(path, `"${path}" breaks the naming convention: ${problems.join('; ')}`);
        continue;
      }
      if (await this.isFresh(manifest.get(path))) continue;
      try {
        await this.importAsset(path);
      } catch (cause) {
        onError?.(path, cause instanceof Error ? cause.message : String(cause));
      }
    }

    for (const path of [...manifest.keys()]) {
      if (found.has(path)) continue;
      manifest.delete(path);
      dirty = true;
    }
    if (dirty) await this.save();
    return this.entries();
  }

  async setThumbnail(relPath: string, image: Uint8Array): Promise<AssetEntry> {
    const path = toPosix(relPath);
    const manifest = await this.load();
    const entry = manifest.get(path);
    if (!entry) throw new HttpError(404, `no asset at "${path}"`);

    const thumbnail = `thumbnails/${path.replace(/\.glb$/i, '')}.png`;
    await writeAtomic(containedJoin(this.paths.cache, thumbnail), image);
    const updated = { ...entry, thumbnail };
    manifest.set(path, updated);
    await this.save();
    return updated;
  }

  /**
   * Fresh means: same mtime, same size, and the cached file still exists.
   * mtime alone misses a restore from backup; size alone misses an edit that
   * kept the byte count; and both miss someone deleting `.cache/` by hand.
   */
  private async isFresh(entry: AssetEntry | undefined): Promise<boolean> {
    if (!entry) return false;
    try {
      const source = await stat(containedJoin(this.paths.assets, entry.path));
      if (source.mtimeMs !== entry.sourceMtimeMs || source.size !== entry.sourceSize) return false;
      await stat(containedJoin(this.paths.cache, entry.cached));
      return true;
    } catch {
      return false;
    }
  }

  /** Every .glb under assets/, as posix paths relative to it. */
  private async walk(): Promise<Set<string>> {
    const out = new Set<string>();
    const visit = async (dir: string, prefix: string): Promise<void> => {
      let listing;
      try {
        listing = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
      for (const item of listing) {
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) await visit(join(dir, item.name), rel);
        else if (item.name.toLowerCase().endsWith('.glb')) out.add(rel);
      }
    };
    await visit(this.paths.assets, '');
    return out;
  }

  private async load(): Promise<Map<string, AssetEntry>> {
    if (this.manifest) return this.manifest;
    let entries: AssetEntry[] = [];
    try {
      const text = await readFile(join(this.paths.cache, MANIFEST), 'utf8');
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) entries = parsed as AssetEntry[];
    } catch {
      // A missing or corrupt manifest is not an error: it is derived state, and
      // the next scan rebuilds it from the sources.
      entries = [];
    }
    this.manifest = new Map(entries.map((e) => [e.path, e]));
    return this.manifest;
  }

  private async save(): Promise<void> {
    const entries = await this.entries();
    await writeAtomic(
      join(this.paths.cache, MANIFEST),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
  }
}
