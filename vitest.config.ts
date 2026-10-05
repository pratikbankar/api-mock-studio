import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 30000,
    env: { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:27017/unused' },
  },
});
