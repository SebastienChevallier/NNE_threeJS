import { describe, expect, it } from 'vitest';
import type { EditorPhase } from '../src/types.js';

describe('editor package', () => {
  it('is wired up', () => {
    const phase: EditorPhase = 'edit';
    expect(phase).toBe('edit');
  });
});
