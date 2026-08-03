import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

/**
 * Writes a file by replacing it wholesale: temp file first, then `rename`.
 *
 * A reader either sees the old file or the new one, never a half-written scene.
 * The temp file is a sibling of the target on purpose — `rename` is only atomic
 * within one filesystem, and the OS temp dir is frequently a different mount.
 */
export async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });

  // Random suffix rather than a pid or a counter: two concurrent writes to the
  // same target must not pick the same temp name and clobber each other.
  const temp = join(dir, `.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temp, data);
    await rename(temp, file);
  } catch (cause) {
    // Best effort: the temp file may not exist if writeFile is what failed.
    await rm(temp, { force: true }).catch(() => undefined);
    throw cause;
  }
}
