import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject } from '../src/paths.js';
import { AssetPipeline } from '../src/assets/pipeline.js';
import type { AssetMetadata } from '../src/types.js';
import type { AssetOptimizer, OptimizeRequest } from '../src/assets/optimizer.js';

const metadata: AssetMetadata = {
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  animations: ['Idle'],
  triangles: 12,
};

/** Records every call and writes a stub file, so the pipeline is tested alone. */
function fakeOptimizer() {
  const calls: OptimizeRequest[] = [];
  const optimizer: AssetOptimizer = {
    async run(request) {
      calls.push(request);
      await mkdir(join(request.target, '..'), { recursive: true });
      await writeFile(request.target, 'optimized');
      return metadata;
    },
  };
  return { calls, optimizer };
}

describe('AssetPipeline', () => {
  let dir: string;
  let pipeline: AssetPipeline;
  let fake: ReturnType<typeof fakeOptimizer>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-pipeline-'));
    await mkdir(join(dir, 'assets', 'props'), { recursive: true });
    fake = fakeOptimizer();
    pipeline = new AssetPipeline(resolveProject(dir), fake.optimizer);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function writeAsset(rel: string, content = 'source'): Promise<void> {
    const file = join(dir, 'assets', rel);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, content);
  }

  describe('importAsset', () => {
    it('optimizes into the cache and records an entry', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      const entry = await pipeline.importAsset('props/PRP_Chair_01.glb');

      expect(entry.category).toBe('PRP');
      expect(entry.cached).toBe('assets/props/PRP_Chair_01.glb');
      expect(entry.metadata).toEqual(metadata);
      expect(entry.thumbnail).toBeNull();
      expect(await readFile(join(dir, '.cache', entry.cached), 'utf8')).toBe('optimized');
    });

    it('passes the category to the optimizer so texture limits apply', async () => {
      await writeAsset('chars/CHR_Hero.glb');
      await pipeline.importAsset('chars/CHR_Hero.glb');
      expect(fake.calls[0]?.category).toBe('CHR');
    });

    it('refuses an asset that breaks the naming convention', async () => {
      await writeAsset('props/Chair.glb');
      await expect(pipeline.importAsset('props/Chair.glb')).rejects.toMatchObject({ status: 400 });
      expect(fake.calls).toHaveLength(0);
    });

    it('refuses a path that escapes the assets folder', async () => {
      await expect(pipeline.importAsset('../../etc/passwd')).rejects.toThrow();
    });

    it('reports a missing source as 404', async () => {
      await expect(pipeline.importAsset('props/PRP_Ghost.glb')).rejects.toMatchObject({ status: 404 });
    });

    it('persists the manifest so a new pipeline sees the entry', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.importAsset('props/PRP_Chair_01.glb');

      const reopened = new AssetPipeline(resolveProject(dir), fake.optimizer);
      expect(await reopened.entries()).toHaveLength(1);
    });

    it('uses posix separators in the manifest whatever the platform', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      const entry = await pipeline.importAsset('props\\PRP_Chair_01.glb');
      expect(entry.path).toBe('props/PRP_Chair_01.glb');
    });
  });

  describe('scanAll', () => {
    it('imports every asset found under assets/', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await writeAsset('chars/CHR_Hero.glb');
      const entries = await pipeline.scanAll();
      expect(entries.map((e) => e.path).sort())
        .toEqual(['chars/CHR_Hero.glb', 'props/PRP_Chair_01.glb']);
    });

    it('skips an unchanged asset on the second scan', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(1);
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(1);
    });

    it('re-optimizes an asset whose content changed', async () => {
      await writeAsset('props/PRP_Chair_01.glb', 'source');
      await pipeline.scanAll();
      await writeAsset('props/PRP_Chair_01.glb', 'a much longer source than before');
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(2);
    });

    it('re-optimizes an asset whose content changed while its mtime was preserved', async () => {
      // Tools that restore from backup, and rsync with --times, both rewrite a
      // file without moving its mtime. Only the size tells them apart, so this
      // is what isolates the size check from the mtime check.
      const file = join(dir, 'assets', 'props', 'PRP_Chair_01.glb');
      // Both writes are stamped with the same instant rather than reading the
      // first one back: `utimes` takes a Date, so a read-then-restore loses the
      // sub-millisecond part of mtimeMs and the mtime check would fire anyway,
      // hiding whether the size check works at all.
      const stamp = new Date(Date.now() - 60_000);

      await writeAsset('props/PRP_Chair_01.glb', 'source');
      await utimes(file, stamp, stamp);
      const stamped = (await stat(file)).mtimeMs;
      await pipeline.scanAll();

      await writeAsset('props/PRP_Chair_01.glb', 'a different, longer source');
      await utimes(file, stamp, stamp);
      // Compared against what the filesystem actually stored the first time,
      // not against stamp.getTime(): the stored value can land a fraction of a
      // millisecond off, and asserting the ideal makes the test flaky.
      expect((await stat(file)).mtimeMs).toBe(stamped);

      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(2);
    });

    it('re-optimizes an asset that was touched without changing size', async () => {
      await writeAsset('props/PRP_Chair_01.glb', 'source');
      await pipeline.scanAll();
      const later = new Date(Date.now() + 60_000);
      await utimes(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), later, later);
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(2);
    });

    it('re-optimizes when the cached file is gone even if the source is unchanged', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.scanAll();
      await rm(join(dir, '.cache', 'assets', 'props', 'PRP_Chair_01.glb'));
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(2);
    });

    it('drops entries whose source disappeared', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.scanAll();
      await rm(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'));
      expect(await pipeline.scanAll()).toEqual([]);
    });

    it('reports a failing asset without aborting the whole scan', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await writeAsset('props/PRP_Broken.glb');
      const failing: AssetOptimizer = {
        async run(request) {
          if (request.source.includes('Broken')) throw new Error('boom');
          return fake.optimizer.run(request);
        },
      };
      const onError = vi.fn();
      const p = new AssetPipeline(resolveProject(dir), failing);
      const entries = await p.scanAll(onError);

      expect(entries.map((e) => e.path)).toEqual(['props/PRP_Chair_01.glb']);
      expect(onError).toHaveBeenCalledWith('props/PRP_Broken.glb', expect.stringContaining('boom'));
    });

    it('returns an empty list when assets/ does not exist', async () => {
      await rm(join(dir, 'assets'), { recursive: true, force: true });
      expect(await pipeline.scanAll()).toEqual([]);
    });

    it('ignores non-glb files instead of failing the scan', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await writeAsset('props/notes.txt');
      expect((await pipeline.scanAll()).map((e) => e.path)).toEqual(['props/PRP_Chair_01.glb']);
    });

    it('reports a misnamed .glb without importing it', async () => {
      await writeAsset('props/Chair.glb');
      const onError = vi.fn();
      expect(await pipeline.scanAll(onError)).toEqual([]);
      expect(onError).toHaveBeenCalledWith('props/Chair.glb', expect.stringContaining('convention'));
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe('concurrency', () => {
    /** Counts how many optimizations overlap, which is the corrupting case. */
    function countingOptimizer(delayMs: number) {
      let active = 0;
      let maxActive = 0;
      const optimizer: AssetOptimizer = {
        async run({ target }) {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, delayMs));
          await mkdir(join(target, '..'), { recursive: true });
          await writeFile(target, 'optimized');
          active--;
          return metadata;
        },
      };
      return { optimizer, max: () => maxActive };
    }

    it('never optimizes the same asset twice at once', async () => {
      // The hot-reload path makes this ordinary: Blender re-saving during a
      // long optimization starts a second one for the same file, and both
      // would write the same cache path. NodeIO.write is not atomic.
      await writeAsset('props/PRP_Chair_01.glb');
      const counting = countingOptimizer(50);
      const p = new AssetPipeline(resolveProject(dir), counting.optimizer);

      await Promise.all([
        p.importAsset('props/PRP_Chair_01.glb'),
        p.importAsset('props/PRP_Chair_01.glb'),
      ]);
      expect(counting.max()).toBe(1);
    });

    it('still optimizes different assets in parallel', async () => {
      // Serializing everything would make a first scan needlessly slow; the
      // lock is per path, not global.
      await writeAsset('props/PRP_Chair_01.glb');
      await writeAsset('props/PRP_Table_01.glb');
      const counting = countingOptimizer(50);
      const p = new AssetPipeline(resolveProject(dir), counting.optimizer);

      await Promise.all([
        p.importAsset('props/PRP_Chair_01.glb'),
        p.importAsset('props/PRP_Table_01.glb'),
      ]);
      expect(counting.max()).toBe(2);
    });

    it('runs a queued import even when the one before it failed', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      let first = true;
      const flaky: AssetOptimizer = {
        async run(request) {
          if (first) {
            first = false;
            throw new Error('boom');
          }
          return fake.optimizer.run(request);
        },
      };
      const p = new AssetPipeline(resolveProject(dir), flaky);

      const [failed, succeeded] = await Promise.allSettled([
        p.importAsset('props/PRP_Chair_01.glb'),
        p.importAsset('props/PRP_Chair_01.glb'),
      ]);
      expect(failed?.status).toBe('rejected');
      expect(succeeded?.status).toBe('fulfilled');
    });

    it('does not delete a cached file while an import is writing it', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      const counting = countingOptimizer(50);
      const p = new AssetPipeline(resolveProject(dir), counting.optimizer);

      const importing = p.importAsset('props/PRP_Chair_01.glb');
      const removing = p.removeAsset('props/PRP_Chair_01.glb');
      await Promise.all([importing, removing]);

      // The remove ran after the import, so it wins: no entry, no cached file.
      expect(await p.entries()).toEqual([]);
      await expect(readFile(join(dir, '.cache', 'assets/props/PRP_Chair_01.glb')))
        .rejects.toThrow();
    });
  });

  describe('removeAsset', () => {
    it('drops the entry and the cached file', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      const entry = await pipeline.importAsset('props/PRP_Chair_01.glb');
      await pipeline.removeAsset('props/PRP_Chair_01.glb');

      expect(await pipeline.entries()).toEqual([]);
      await expect(readFile(join(dir, '.cache', entry.cached))).rejects.toThrow();
    });

    it('is a no-op for an unknown asset', async () => {
      await expect(pipeline.removeAsset('props/PRP_Nope.glb')).resolves.toBeUndefined();
    });
  });

  describe('setThumbnail', () => {
    it('stores the image and points the entry at it', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.importAsset('props/PRP_Chair_01.glb');
      const entry = await pipeline.setThumbnail(
        'props/PRP_Chair_01.glb', new Uint8Array([137, 80, 78, 71]),
      );

      expect(entry.thumbnail).toBe('thumbnails/props/PRP_Chair_01.png');
      expect(new Uint8Array(await readFile(join(dir, '.cache', entry.thumbnail as string))))
        .toEqual(new Uint8Array([137, 80, 78, 71]));
    });

    it('refuses a thumbnail for an unknown asset', async () => {
      await expect(pipeline.setThumbnail('props/PRP_Nope.glb', new Uint8Array()))
        .rejects.toMatchObject({ status: 404 });
    });

    it('survives a re-import: the thumbnail is not lost', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.importAsset('props/PRP_Chair_01.glb');
      await pipeline.setThumbnail('props/PRP_Chair_01.glb', new Uint8Array([1]));
      await writeAsset('props/PRP_Chair_01.glb', 'changed content here');
      const entry = await pipeline.importAsset('props/PRP_Chair_01.glb');
      expect(entry.thumbnail).toBe('thumbnails/props/PRP_Chair_01.png');
    });
  });
});
