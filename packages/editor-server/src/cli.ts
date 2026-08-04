import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { stringifyScene, type SceneFile } from '@nne/core';
import { writeAtomic } from './atomic.js';
import { resolveProject, type ProjectPaths } from './paths.js';
import { startEditorServer } from './main.js';

export interface CliArgs {
  root: string;
  port: number;
  host: string;
}

const DEFAULT_ROOT = 'projects/demo';
const DEFAULT_PORT = 5174;

/**
 * Parses the command line.
 *
 * Kept separate from `main` and exported so the parsing is testable without
 * starting a server or binding a port.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { root: DEFAULT_ROOT, port: DEFAULT_PORT, host: '127.0.0.1' };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error(`--port expects a port number, got "${String(argv[i])}"`);
      }
      args.port = value;
    } else if (arg === '--host') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--host expects a value');
      args.host = value;
    } else if (arg !== undefined && !arg.startsWith('--')) {
      args.root = arg;
    } else if (arg !== undefined) {
      throw new Error(`unknown option "${arg}"`);
    }
  }
  return args;
}

/**
 * Anchors a relative project root to where the command was actually invoked
 * from, not to this process's cwd.
 *
 * `pnpm --filter @nne/editor-server start` — which `pnpm run editor` and
 * `pnpm run start` both go through — runs the script with its cwd set to
 * `packages/editor-server`. Resolving "projects/demo" against that would
 * create the project *inside* the package folder instead of at the repo root,
 * which is confusing on its own and actively wrong once `.gitignore` and the
 * workspace layout assume `projects/` sits next to `packages/`.
 *
 * pnpm sets `INIT_CWD` to the directory the command was originally run from,
 * which survives being relayed through `concurrently` and a nested
 * `pnpm --filter`. An absolute root is returned unchanged either way.
 */
export function resolveRoot(root: string, initCwd: string | undefined): string {
  if (isAbsolute(root)) return root;
  return join(initCwd ?? process.cwd(), root);
}

/** The scene a brand-new project opens on: a camera and a light, nothing else. */
export function starterScene(): SceneFile {
  return {
    version: 1,
    name: 'Scene_01',
    entities: [
      {
        id: 1,
        name: 'Camera',
        components: {
          Camera: { fov: 60, near: 0.1, far: 1000, active: true },
          Transform: { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      },
      {
        id: 2,
        name: 'Soleil',
        components: {
          Light: { type: 'directional', color: '#ffffff', intensity: 1 },
          Transform: { position: [3, 5, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      },
    ],
  };
}

/**
 * Creates the folders a project needs, and a starter scene if it has none.
 *
 * `startEditorServer` already writes project.json, but an empty folder with no
 * `assets/` gives a user nowhere obvious to drop a .glb, and an editor opening
 * on no scene at all looks broken rather than new.
 *
 * Returns true when it created the starter scene.
 */
export async function scaffoldProject(paths: ProjectPaths): Promise<boolean> {
  await mkdir(paths.assets, { recursive: true });
  await mkdir(paths.scenes, { recursive: true });

  const { readdir } = await import('node:fs/promises');
  const existing = await readdir(paths.scenes);
  if (existing.some((name) => name.endsWith('.json'))) return false;

  await writeAtomic(`${paths.scenes}/Scene_01.json`, stringifyScene(starterScene()));
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = resolveRoot(args.root, process.env['INIT_CWD']);
  const paths = resolveProject(root);

  const created = await scaffoldProject(paths);
  const server = await startEditorServer({ root, port: args.port, host: args.host });

  console.log(`  projet     ${paths.root}`);
  if (created) console.log('             scène de départ créée : Scene_01');
  console.log(`  API        http://${args.host}:${server.port}`);
  console.log('  éditeur    http://localhost:5173');
  console.log('\n  Ctrl+C pour arrêter.\n');

  const stop = (): void => {
    // Closing releases the port and the watcher; without it a restart would
    // fail on EADDRINUSE.
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// Only run when executed, never when imported by a test.
if (process.argv[1]?.endsWith('cli.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
