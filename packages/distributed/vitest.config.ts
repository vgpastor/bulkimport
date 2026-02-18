import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@batchactions/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@batchactions/import': path.resolve(__dirname, '../import/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
