import { isAbsolute, join, resolve, sep } from 'node:path';

/** Every directory the server is allowed to touch, derived from one root. */
export interface ProjectPaths {
  root: string;
  projectFile: string;
  scenes: string;
  assets: string;
  cache: string;
}

export function resolveProject(root: string): ProjectPaths {
  const absolute = resolve(root);
  return {
    root: absolute,
    projectFile: join(absolute, 'project.json'),
    scenes: join(absolute, 'scenes'),
    assets: join(absolute, 'assets'),
    cache: join(absolute, '.cache'),
  };
}

/**
 * Joins a caller-supplied relative path onto a trusted base, refusing anything
 * that lands outside it.
 *
 * Three layered guards, deliberately redundant. The `..` rejection is the one
 * that does the work in practice: with it in place, no input can reach the
 * containment check and escape, which is why mutating either of the other two
 * leaves the tests green. They stay because they fail independently — the
 * `startsWith` uses `root + sep` so that `/base-evil` is not read as a child of
 * `/base`, and that matters the day someone relaxes the `..` rule to allow a
 * legitimate relative path. Removing them would make this function correct only
 * by accident of ordering.
 */
export function containedJoin(base: string, relative: string): string {
  if (relative.length === 0) throw new Error('path segment is empty');
  if (relative.includes('\0')) throw new Error('path segment is invalid: contains NUL');
  if (isAbsolute(relative)) throw new Error(`path "${relative}" escapes the project directory`);

  // A path that leaves and comes back is a probe, not a typo: `..` never has a
  // legitimate use in a request, so it is refused even when it resolves inside.
  if (relative.split(/[/\\]/).includes('..')) {
    throw new Error(`path "${relative}" escapes the project directory`);
  }

  const root = resolve(base);
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path "${relative}" escapes the project directory`);
  }
  return target;
}

/** Scene names index files directly, so they are allow-listed, never sanitized. */
const SCENE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidSceneName(name: string): boolean {
  return SCENE_NAME.test(name);
}

/** Manifests and API payloads always use forward slashes, on every platform. */
export function toPosix(p: string): string {
  return p.split(sep).join('/').split('\\').join('/');
}
