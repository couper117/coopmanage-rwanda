import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
    env: {
      NODE_ENV: 'test',
      // Uploads go to a throwaway directory rather than the development store, so a test run
      // cannot leave files among a developer's own and the whole lot can be removed at the end.
      STORAGE_LOCAL_PATH: './storage-test',
    },
    setupFiles: ['test/setup.ts'],
    globalSetup: ['test/globalSetup.ts'],
  },
})
