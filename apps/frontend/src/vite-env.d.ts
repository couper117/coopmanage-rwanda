/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_APP_ENV?: string
  /**
   * Identifies the build, so the persisted query cache can discard what a new deployment cannot
   * be trusted to read. Unset in development, where a stable value is what lets a hot-reloaded
   * session keep its cache.
   */
  readonly VITE_BUILD_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
