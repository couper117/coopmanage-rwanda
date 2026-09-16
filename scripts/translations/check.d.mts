/**
 * Types for the translation checker.
 *
 * Hand-written rather than generated: the checker is a plain Node ES module so that CI can run it
 * with `node` and no build step, and this is what lets the frontend test suite import it with the
 * same rules type-checked.
 */

/** Absolute path to `apps/frontend/src/i18n/locales`. */
export declare const LOCALES_DIR: string

export declare const LANGUAGES: readonly string[]

/**
 * Runs every translation rule and returns the failures as readable lines. An empty array means the
 * English and Kinyarwanda bundles are in step.
 */
export declare function runChecks(): string[]
