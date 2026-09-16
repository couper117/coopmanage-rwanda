import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Identifies this build, so the persisted query cache discards what a new deployment cannot be
 * trusted to read.
 *
 * A timestamp rather than a git hash: it needs no git in the build image, it always changes when a
 * build happens, and nothing reads it for anything but equality. In development it is not defined
 * at all, which is what lets a hot-reloaded session keep its cache instead of clearing it on every
 * save. `src/app/persistCache.ts` is the other half.
 */
const BUILD_ID = new Date().toISOString()

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  ...(command === 'build'
    ? { define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID) } }
    : {}),
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // 5173 and 5174 are taken by other projects on this machine. strictPort keeps the port
    // predictable so the backend CORS allow-list and this value cannot drift apart.
    port: 5175,
    strictPort: true,
    proxy: {
      // Keeps the browser on one origin in development, so cookies and CORS behave as they will
      // in production without extra configuration.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * Grouped by when a cooperative actually needs the code, not by package name.
         *
         * A function rather than the array form, which matches module ids exactly and therefore
         * missed `react-dom/client` — the bulk of React's runtime sat in the entry chunk for three
         * phases because of it.
         *
         * `forms` is the useful split: zod and react-hook-form together are the largest dependency
         * in this application and are needed only by screens with a form on them. The dashboard,
         * which is the first thing a cooperative sees, now never downloads them.
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined

          if (
            /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)
          ) {
            return 'react'
          }
          if (id.includes('node_modules/zod/') || id.includes('react-hook-form')) return 'forms'
          if (id.includes('@radix-ui') || id.includes('@floating-ui')) return 'radix'
          if (id.includes('@tanstack')) return 'query'
          if (/node_modules\/(i18next|react-i18next|i18next-browser-languagedetector)\//.test(id)) {
            return 'i18n'
          }
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    // A test that mounts a screen now waits for its module to be transformed as well as for its
    // data. `test/setup.ts` explains why five seconds of waiting is the honest budget; the test
    // itself is given three times that so a slow transform fails the assertion rather than the
    // runner.
    testTimeout: 15_000,
    // A test's `afterEach` calls `changeLanguage`, which now loads the namespaces already in use in
    // the language being switched to. That is real asynchronous work — the same work the interface
    // does — so the hook needs the same budget as the test.
    hookTimeout: 15_000,
    /**
     * Four workers, not one per core.
     *
     * Since the screens became lazy, a test resolves page modules through Vite's transform server
     * while it runs rather than once when the file is imported. Seven workers all waiting on that
     * one server turned a 40-second suite into a run where a different handful of files timed out
     * every time — including tests that render nothing but a button, which is the tell that the
     * cause is the runner and not the code.
     */
    maxWorkers: 4,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    globals: true,
    css: false,
  },
}))
