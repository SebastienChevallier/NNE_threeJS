import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintAssets } from '../src/lint-assets.js';

describe('lintAssets', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-lint-'));
    await mkdir(join(dir, 'assets', 'props'), { recursive: true });
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('is silent on a conforming project', async () => {
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
    expect(await lintAssets(dir)).toEqual([]);
  });

  it('reports a missing prefix with the path', async () => {
    await writeFile(join(dir, 'assets', 'props', 'Chair.glb'), 'x');
    const problems = await lintAssets(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('props/Chair.glb');
  });

  it('reports every offending file, not just the first', async () => {
    await writeFile(join(dir, 'assets', 'props', 'Chair.glb'), 'x');
    await writeFile(join(dir, 'assets', 'props', 'Table.glb'), 'x');
    expect(await lintAssets(dir)).toHaveLength(2);
  });

  it('finds files nested several folders deep', async () => {
    await mkdir(join(dir, 'assets', 'a', 'b', 'c'), { recursive: true });
    await writeFile(join(dir, 'assets', 'a', 'b', 'c', 'Chair.glb'), 'x');
    expect((await lintAssets(dir))[0]).toContain('a/b/c/Chair.glb');
  });

  it('is silent on a project with no assets folder', async () => {
    await rm(join(dir, 'assets'), { recursive: true, force: true });
    expect(await lintAssets(dir)).toEqual([]);
  });

  it('ignores files that are not .glb', async () => {
    await writeFile(join(dir, 'assets', 'props', 'notes.txt'), 'x');
    expect(await lintAssets(dir)).toEqual([]);
  });
});
