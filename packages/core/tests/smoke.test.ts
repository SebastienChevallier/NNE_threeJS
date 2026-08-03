import { describe, expect, it } from 'vitest';
import type { FieldSpec } from '../src/types.js';

describe('toolchain', () => {
  it('runs typed tests', () => {
    const spec: FieldSpec = { type: 'vec3', default: [0, 0, 0] };
    expect(spec.type).toBe('vec3');
  });
});
