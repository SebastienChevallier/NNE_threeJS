import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject } from '../src/paths.js';
import { AssetPipeline } from '../src/assets/pipeline.js';
import { createWatcher, type ProjectWatcher } from '../src/watcher.js';
import type { AssetOptimizer } from '../src/assets/optimizer.js';
import type { ProjectEvent } from '../src/types.js';

const optimizer: AssetOptimizer = {
  async run({ target }) {
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, 'optimized');
    return { bounds: { min: [0, 0, 0], max: [0, 0, 0] }, animations: [], triangles: 0 };
  },
};

/** Waits for a matching event, so tests never sleep on a fixed delay. */
function nextEvent(
  events: ProjectEvent[],
  match: (e: ProjectEvent) => boolean,
): Promise<ProjectEvent> {
  return vi.waitFor(() => {
    const found = events.find(match);
    if (!found) throw new Error(`no matching event yet in ${JSON.stringify(events)}`);
    return found;
  }, { timeout: 15_000, interval: 50 });
}

describe('createWatcher', () => {
  let dir: string;
  let watcher: ProjectWatcher;
  let events: ProjectEvent[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-watch-'));
    await mkdir(join(dir, 'assets', 'props'), { recursive: true });
    await mkdir(join(dir, 'scenes'), { recursive: true });
    events = [];
    const paths = resolveProject(dir);
    watcher = await createWatcher({
      paths,
      pipeline: new AssetPipeline(paths, optimizer),
      emit: (event) => events.push(event),
    });
  });
  afterEach(async () => {
    await watcher.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('emits asset-changed when a .glb appears', async () => {
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
    const event = await nextEvent(events, (e) => e.type === 'asset-changed');
    expect(event).toMatchObject({ type: 'asset-changed', path: 'props/PRP_Chair_01.glb' });
  });

  it('optimizes into the cache before emitting', async () => {
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
    const event = await nextEvent(events, (e) => e.type === 'asset-changed');
    expect(event).toMatchObject({ entry: { cached: 'assets/props/PRP_Chair_01.glb' } });
  });

  it('emits asset-removed when a .glb is deleted', async () => {
    const file = join(dir, 'assets', 'props', 'PRP_Chair_01.glb');
    await writeFile(file, 'x');
    await nextEvent(events, (e) => e.type === 'asset-changed');
    await rm(file);
    await nextEvent(events, (e) => e.type === 'asset-removed');
  });

  it('emits asset-failed and keeps watching when an asset breaks the convention', async () => {
    await writeFile(join(dir, 'assets', 'props', 'Chair.glb'), 'x');
    await nextEvent(events, (e) => e.type === 'asset-failed');

    // Still alive: a good asset after a bad one is still processed.
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
    await nextEvent(events, (e) => e.type === 'asset-changed');
  });

  it('emits scene-changed when a scene file is written', async () => {
    await writeFile(join(dir, 'scenes', 'Scene_01.json'), '{}');
    const event = await nextEvent(events, (e) => e.type === 'scene-changed');
    expect(event).toMatchObject({ type: 'scene-changed', name: 'Scene_01' });
  });

  it('ignores files inside .cache, so its own writes do not loop', async () => {
    await mkdir(join(dir, '.cache'), { recursive: true });
    await writeFile(join(dir, '.cache', 'noise.glb'), 'x');
    await new Promise((r) => setTimeout(r, 1000));
    expect(events).toEqual([]);
  });

  it('ignores a non-glb file dropped in assets/', async () => {
    await writeFile(join(dir, 'assets', 'props', 'notes.txt'), 'x');
    await new Promise((r) => setTimeout(r, 1000));
    expect(events).toEqual([]);
  });

  it('closes cleanly and stops emitting', async () => {
    await watcher.close();
    await writeFile(join(dir, 'assets', 'props', 'PRP_Late.glb'), 'x');
    await new Promise((r) => setTimeout(r, 1000));
    expect(events.filter((e) => e.type === 'asset-changed')).toEqual([]);
  });
});
