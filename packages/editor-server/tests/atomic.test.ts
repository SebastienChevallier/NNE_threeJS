import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAtomic } from '../src/atomic.js';

describe('writeAtomic', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nne-atomic-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes a new file', async () => {
    const file = join(dir, 'a.json');
    await writeAtomic(file, '{"a":1}');
    expect(await readFile(file, 'utf8')).toBe('{"a":1}');
  });

  it('replaces an existing file', async () => {
    const file = join(dir, 'a.json');
    await writeFile(file, 'old');
    await writeAtomic(file, 'new');
    expect(await readFile(file, 'utf8')).toBe('new');
  });

  it('leaves no temp file behind on success', async () => {
    await writeAtomic(join(dir, 'a.json'), 'x');
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  it('creates the parent directory when missing', async () => {
    const file = join(dir, 'nested', 'deep', 'a.json');
    await writeAtomic(file, 'x');
    expect(await readFile(file, 'utf8')).toBe('x');
  });

  it('keeps the previous content when the write fails', async () => {
    const file = join(dir, 'a.json');
    await writeFile(file, 'original');
    // A directory where the temp file wants to go is not something we can force
    // portably, so failure is provoked with data the encoder rejects.
    await expect(writeAtomic(file, undefined as unknown as string)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('original');
  });

  it('leaves no temp file behind on failure', async () => {
    const file = join(dir, 'a.json');
    await writeFile(file, 'original');
    await expect(writeAtomic(file, undefined as unknown as string)).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  it('writes binary data unchanged', async () => {
    const file = join(dir, 'a.bin');
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await writeAtomic(file, bytes);
    expect(new Uint8Array(await readFile(file))).toEqual(bytes);
  });

  it('does not interleave two concurrent writes to the same target', async () => {
    const file = join(dir, 'a.json');
    await Promise.all([
      writeAtomic(file, 'a'.repeat(10_000)),
      writeAtomic(file, 'b'.repeat(10_000)),
    ]);
    const content = await readFile(file, 'utf8');
    // Whichever won, the file is one complete write, never a mix of both.
    expect(content === 'a'.repeat(10_000) || content === 'b'.repeat(10_000)).toBe(true);
    expect(await readdir(dir)).toEqual(['a.json']);
  });
});
