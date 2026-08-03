import type { AssetCategory } from '../types.js';

/** The four category prefixes every asset file name must start with. */
export const ASSET_PREFIXES = ['CHR', 'PRP', 'ENV', 'UI'] as const;

/**
 * Hard texture ceiling per category, in pixels.
 *
 * The spec gives ranges for characters (512-1024) and props (256-512); the top
 * of each range is the cap. ENV and UI are not specified: environments cover
 * large surfaces so they get the character budget, UI is flat so it gets the
 * prop budget.
 */
export const TEXTURE_LIMITS: Record<AssetCategory, number> = {
  CHR: 1024,
  PRP: 512,
  ENV: 1024,
  UI: 512,
};

/** Animation clip names the project standardizes on. */
export const STANDARD_ANIMATIONS = ['Idle', 'Alert', 'Action_01'] as const;

function baseName(relPath: string): string {
  const parts = relPath.split(/[/\\]/);
  return parts[parts.length - 1] ?? '';
}

/** The category a file declares through its prefix, or null if it declares none. */
export function categoryOf(relPath: string): AssetCategory | null {
  const name = baseName(relPath);
  for (const prefix of ASSET_PREFIXES) {
    if (name.startsWith(`${prefix}_`)) return prefix;
  }
  return null;
}

/**
 * Lints one asset path against the project conventions.
 * Returns every problem, not the first: this doubles as the CLI linter, where
 * a full list is the difference between one fix pass and five.
 */
export function validateAssetPath(relPath: string): string[] {
  const name = baseName(relPath);
  const problems: string[] = [];

  if (categoryOf(relPath) === null) {
    problems.push(
      `"${name}" has no category prefix: expected one of ${ASSET_PREFIXES.map((p) => `${p}_`).join(', ')}`,
    );
  }
  if (!name.toLowerCase().endsWith('.glb')) {
    problems.push(`"${name}" is not a .glb: .glb is the project's only export format`);
  }
  if (/\s/.test(name)) {
    problems.push(`"${name}" contains a space: use underscores`);
  }
  return problems;
}
