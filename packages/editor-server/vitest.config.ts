import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The pipeline tests write real files to a temp dir; the default 5s is
    // tight once gltf-transform runs for real.
    testTimeout: 20_000,
  },
});
