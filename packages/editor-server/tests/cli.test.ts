import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentRegistry, registerBuiltins, validateScene } from '@nne/core';
import { parseArgs, resolveRoot, scaffoldProject, starterScene } from '../src/cli.js';
import { resolveProject } from '../src/paths.js';

describe('parseArgs', () => {
  it('defaults to a demo project on the conventional port', () => {
    expect(parseArgs([])).toEqual({ root: 'projects/demo', port: 5174, host: '127.0.0.1' });
  });

  it('takes the project folder as a positional argument', () => {
    expect(parseArgs(['projects/mon-jeu']).root).toBe('projects/mon-jeu');
  });

  it('accepts a port', () => {
    expect(parseArgs(['--port', '6000']).port).toBe(6000);
  });

  it('accepts a host', () => {
    expect(parseArgs(['--host', '0.0.0.0']).host).toBe('0.0.0.0');
  });

  it('defaults the host to loopback: the API has no authentication', () => {
    expect(parseArgs([]).host).toBe('127.0.0.1');
  });

  it('rejects a port that is not a port', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/--port/);
    expect(() => parseArgs(['--port', '99999'])).toThrow(/--port/);
    expect(() => parseArgs(['--port', '-1'])).toThrow(/--port/);
  });

  it('rejects an unknown option rather than ignoring it', () => {
    // Silently dropping a typo'd flag means the server starts with settings the
    // user did not ask for and thinks they got.
    expect(() => parseArgs(['--prot', '6000'])).toThrow(/unknown option/);
  });

  it('rejects a host flag with nothing after it', () => {
    expect(() => parseArgs(['--host'])).toThrow(/--host/);
  });

  it('takes options and a folder together, in any order', () => {
    expect(parseArgs(['--port', '6000', 'projects/x'])).toMatchObject({
      root: 'projects/x',
      port: 6000,
    });
    expect(parseArgs(['projects/x', '--port', '6000'])).toMatchObject({
      root: 'projects/x',
      port: 6000,
    });
  });
});

describe('resolveRoot', () => {
  it('anchors a relative root to INIT_CWD, not to process.cwd()', () => {
    // pnpm --filter runs the script with cwd set to the package folder; INIT_CWD
    // is where the command was actually invoked from. Getting this backwards is
    // exactly how "pnpm run editor" from the repo root ends up creating
    // packages/editor-server/projects/demo instead of projects/demo.
    expect(resolveRoot('projects/demo', '/repo')).toBe('/repo/projects/demo');
  });

  it('falls back to process.cwd() when INIT_CWD is unset', () => {
    // e.g. running the CLI directly with `tsx src/cli.ts`, not through pnpm.
    expect(resolveRoot('projects/demo', undefined)).toBe(join(process.cwd(), 'projects/demo'));
  });

  it('leaves an absolute root untouched', () => {
    expect(resolveRoot('/elsewhere/demo', '/repo')).toBe('/elsewhere/demo');
  });
});

describe('starterScene', () => {
  it('is a scene the registry accepts', () => {
    // A starter scene the server would then refuse to save is worse than none.
    const registry = new ComponentRegistry();
    registerBuiltins(registry);
    expect(validateScene(starterScene(), registry)).toEqual([]);
  });

  it('carries an active camera, so the Game View has something to render', () => {
    const camera = starterScene().entities.find((e) => e.components['Camera']);
    expect(camera?.components['Camera']).toMatchObject({ active: true });
  });

  it('carries a light, so a dropped asset is not a black silhouette', () => {
    expect(starterScene().entities.some((e) => e.components['Light'])).toBe(true);
  });
});

describe('scaffoldProject', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nne-cli-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('creates the folders a user needs to find', async () => {
    await scaffoldProject(resolveProject(dir));
    expect((await readdir(dir)).sort()).toEqual(['assets', 'scenes']);
  });

  it('writes a starter scene in the canonical stable form', async () => {
    const paths = resolveProject(dir);
    expect(await scaffoldProject(paths)).toBe(true);

    const text = await readFile(join(paths.scenes, 'Scene_01.json'), 'utf8');
    const registry = new ComponentRegistry();
    registerBuiltins(registry);
    expect(validateScene(JSON.parse(text), registry)).toEqual([]);
  });

  it('leaves an existing project alone', async () => {
    const paths = resolveProject(dir);
    await mkdir(paths.scenes, { recursive: true });
    await writeFile(join(paths.scenes, 'Mine.json'), '{}');

    expect(await scaffoldProject(paths)).toBe(false);
    expect(await readdir(paths.scenes)).toEqual(['Mine.json']);
  });

  it('is idempotent: running it twice changes nothing', async () => {
    const paths = resolveProject(dir);
    await scaffoldProject(paths);
    const before = await readFile(join(paths.scenes, 'Scene_01.json'), 'utf8');

    expect(await scaffoldProject(paths)).toBe(false);
    expect(await readFile(join(paths.scenes, 'Scene_01.json'), 'utf8')).toBe(before);
  });
});
