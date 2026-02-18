import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core/vitest.config.ts',
  'packages/import/vitest.config.ts',
  'packages/distributed/vitest.config.ts',
  'packages/state-sequelize/vitest.config.ts',
]);
