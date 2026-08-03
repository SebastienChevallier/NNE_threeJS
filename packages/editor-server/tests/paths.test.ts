import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { containedJoin, isValidSceneName, resolveProject, toPosix } from '../src/paths.js';

describe('resolveProject', () => {
  it('derives every project path from the root', () => {
    const paths = resolveProject('/tmp/demo');
    expect(paths.root).toBe(resolve('/tmp/demo'));
    expect(paths.projectFile).toBe(join(resolve('/tmp/demo'), 'project.json'));
    expect(paths.scenes).toBe(join(resolve('/tmp/demo'), 'scenes'));
    expect(paths.assets).toBe(join(resolve('/tmp/demo'), 'assets'));
    expect(paths.cache).toBe(join(resolve('/tmp/demo'), '.cache'));
  });

  it('resolves a relative root against the cwd', () => {
    expect(resolveProject('demo').root).toBe(resolve('demo'));
  });
});

describe('containedJoin', () => {
  const base = resolve('/tmp/demo/assets');

  it('joins a plain relative path', () => {
    expect(containedJoin(base, 'props/PRP_Chair_01.glb'))
      .toBe(join(base, 'props', 'PRP_Chair_01.glb'));
  });

  it('rejects a traversal that climbs out', () => {
    expect(() => containedJoin(base, '../../etc/passwd')).toThrow(/escapes/);
  });

  it('rejects a traversal that climbs out and back in under another name', () => {
    // The classic prefix bug: "/tmp/demo/assets-evil" starts with the base
    // string but is not inside the base directory.
    expect(() => containedJoin(base, '../assets-evil/x.glb')).toThrow(/escapes/);
  });

  it('rejects an absolute path', () => {
    expect(() => containedJoin(base, '/etc/passwd')).toThrow(/escapes/);
  });

  it('rejects a path that only re-enters after leaving', () => {
    // Resolves back inside, but only by chance; a caller sending this is
    // probing, so it is refused rather than silently normalized.
    expect(() => containedJoin(base, '../assets/../../demo/assets/x.glb')).toThrow(/escapes/);
  });

  it('rejects an empty segment', () => {
    expect(() => containedJoin(base, '')).toThrow(/empty/);
  });

  it('rejects a NUL byte', () => {
    // Node throws on NUL in paths anyway, but failing here gives the caller a
    // real message instead of an ERR_INVALID_ARG_VALUE from deep inside fs.
    expect(() => containedJoin(base, 'a\0b.glb')).toThrow(/invalid/);
  });

  it('allows the base itself', () => {
    expect(containedJoin(base, '.')).toBe(base);
  });
});

describe('isValidSceneName', () => {
  it('accepts ordinary names', () => {
    expect(isValidSceneName('Scene_01')).toBe(true);
    expect(isValidSceneName('level-2')).toBe(true);
  });

  it('rejects anything that could reach the filesystem', () => {
    for (const bad of ['..', '.', 'a/b', 'a\\b', 'a.json', '', ' ', 'a b', 'a\0b']) {
      expect(isValidSceneName(bad), bad).toBe(false);
    }
  });

  it('rejects a name longer than the limit', () => {
    expect(isValidSceneName('a'.repeat(65))).toBe(false);
    expect(isValidSceneName('a'.repeat(64))).toBe(true);
  });
});

describe('toPosix', () => {
  it('normalizes separators so manifests are identical across platforms', () => {
    expect(toPosix('props\\PRP_Chair_01.glb')).toBe('props/PRP_Chair_01.glb');
    expect(toPosix('props/PRP_Chair_01.glb')).toBe('props/PRP_Chair_01.glb');
  });
});
