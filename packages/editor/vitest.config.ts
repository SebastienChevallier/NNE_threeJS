import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Deliberately the node environment: no jsdom, no DOM in any test. A module
    // that cannot be tested here holds logic that belongs outside a component.
    environment: 'node',
  },
});
