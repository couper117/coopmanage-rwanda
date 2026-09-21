import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    /**
     * Everything in this package is business logic — permissions, roles, money formatting, phone
     * numbers, report labels — shared by both applications, so all of it is measured.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
  },
})
