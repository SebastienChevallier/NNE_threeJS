import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateAssetPath } from './assets/naming.js';
import { resolveProject } from './paths.js';

/**
 * Lints every .glb under a project's `assets/`.
 * Exposed separately from the server so a pre-commit hook can run it without
 * starting Express or touching the cache.
 */
export async function lintAssets(root: string): Promise<string[]> {
  const paths = resolveProject(root);
  const problems: string[] = [];

  const visit = async (dir: string, prefix: string): Promise<void> => {
    let listing;
    try {
      listing = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const item of listing) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        await visit(join(dir, item.name), rel);
      } else if (item.name.toLowerCase().endsWith('.glb')) {
        for (const problem of validateAssetPath(rel)) problems.push(`${rel}: ${problem}`);
      }
    }
  };

  await visit(paths.assets, '');
  return problems.sort();
}
