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
    /**
     * Fifteen seconds, not the default five. A test that signs in hashes a password with argon2,
     * and under coverage instrumentation with several workers doing the same, two tests that
     * take a second on their own crossed five. The budget is generous so a slow machine fails on
     * an assertion rather than on the clock; nothing here legitimately takes that long.
     */
    testTimeout: 15_000,
    hookTimeout: 60_000,
    /**
     * Coverage is measured on the business logic and nothing else: the services, where money and
     * stock move and permissions are decided, and the library underneath them. Routes, schemas and
     * controllers are exercised by the same suite but are wiring, and a percentage across wiring
     * would only flatter the figure. The threshold is a floor under what Phase 17 measured, so a
     * phase that ships a service nobody tests fails the build rather than lowering the average.
     */
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/modules/**/*.service.ts'],
      exclude: ['src/lib/prisma.ts', 'src/lib/logger.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { statements: 85, branches: 70, functions: 90, lines: 88 },
    },
  },
})
