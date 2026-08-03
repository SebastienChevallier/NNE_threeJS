import { describe, expect, it } from 'vitest';
import { PROJECT_VERSION } from '../src/types.js';

describe('editor-server package', () => {
  it('is wired up', () => {
    expect(PROJECT_VERSION).toBe(1);
  });
});
