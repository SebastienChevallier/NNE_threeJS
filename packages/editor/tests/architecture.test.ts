import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

async function sourceFiles(filter: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isDirectory()) await visit(path);
      else if (filter(item.name)) out.push(path);
    }
  };
  await visit(SRC);
  return out;
}

describe('architecture', () => {
  it('finds the sources it is meant to be checking', async () => {
    // Without this, a broken glob would make every guard below pass vacuously.
    expect((await sourceFiles((n) => n.endsWith('.ts'))).length).toBeGreaterThan(5);
    expect((await sourceFiles((n) => n.endsWith('.tsx'))).length).toBeGreaterThan(3);
  });

  it('never mutates the World outside the session', async () => {
    // Every mutation goes through the CommandBus; that is what makes undo
    // exhaustive rather than best-effort, and what will make the AI panel a
    // matter of emitting JSON rather than of trusting generated code.
    const files = await sourceFiles((n) => n.endsWith('.ts') || n.endsWith('.tsx'));
    const offenders: string[] = [];

    for (const file of files) {
      // The session is the one place allowed to touch the World, and game-view
      // clones it wholesale, which is a read.
      if (file.endsWith(join('src', 'session.ts'))) continue;
      const text = await readFile(file, 'utf8');
      if (/\bworld\.(set|spawn|despawn|remove|setParent|rename)\s*\(/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps React away from the World', async () => {
    // React reads the store, which hands it serialized copies. A component
    // holding a World reference would re-render against live mutable state.
    const components = await sourceFiles((n) => n.endsWith('.tsx'));
    const offenders: string[] = [];

    for (const file of components) {
      const text = await readFile(file, 'utf8');
      // Type-only imports are fine: they carry no runtime access.
      if (/^import\s+(?!type\b)[^;]*from\s+'@nne\/core'/m.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps React out of the viewports', async () => {
    // The spec is explicit: React serves the editor chrome, never the runtime.
    // A viewport importing React would put the render loop inside React's.
    const viewports = await sourceFiles((n) => n.endsWith('.ts'));
    const offenders: string[] = [];

    for (const file of viewports) {
      if (!file.includes(join('src', 'viewport'))) continue;
      const text = await readFile(file, 'utf8');
      if (/from\s+'react/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('touches no disk: that is editor-server’s job', async () => {
    const files = await sourceFiles((n) => n.endsWith('.ts') || n.endsWith('.tsx'));
    const offenders: string[] = [];

    for (const file of files) {
      const text = await readFile(file, 'utf8');
      if (/from\s+'(node:)?fs'|from\s+'(node:)?path'/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('does not import the editor server', async () => {
    // They talk over HTTP. An import would put node-only code in the browser
    // bundle and quietly couple the two release cycles.
    const files = await sourceFiles((n) => n.endsWith('.ts') || n.endsWith('.tsx'));
    for (const file of files) {
      expect(await readFile(file, 'utf8')).not.toContain('@nne/editor-server');
    }
  });
});
