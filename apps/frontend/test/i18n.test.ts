import { describe, expect, it } from 'vitest'
import { runChecks } from '../../../scripts/translations/check.mjs'
import { NAMESPACES, SUPPORTED_LANGUAGES } from '../src/i18n'

/**
 * Kinyarwanda is a first-class language in this product, not a translation layer added later, and
 * this suite is part of the mechanism that keeps it that way.
 *
 * **The rules live in one place.** `scripts/translations/check.mjs` holds them, this imports it,
 * and CI runs the same module as its own named step — so a developer sees the failure in the run
 * they were already doing, and CI reports it without anybody opening a test report. A copy of the
 * rules here and another in a script is how the two drift apart until neither is trusted.
 *
 * What the checker enforces: the same namespaces and the same keys in both languages, no empty
 * string, identical interpolation placeholders, no string left as a copy of the English, the
 * straight apostrophe that Kinyarwanda elision actually uses, a singular form beside every string
 * that interpolates `count`, and none of the terms `docs/glossary.md` §8 rules out.
 *
 * What is checked here rather than there: that the application's own namespace list matches the
 * files on disk. The checker reads the directory; this makes sure the code agrees with it.
 */
describe('translations', () => {
  it('passes every rule in the shared checker', () => {
    const failures = runChecks()
    expect(failures, `\n${failures.join('\n')}\n`).toEqual([])
  })

  it('lists exactly the namespaces that exist on disk', async () => {
    const { readdirSync } = await import('node:fs')
    const { LOCALES_DIR } = await import('../../../scripts/translations/check.mjs')

    for (const language of SUPPORTED_LANGUAGES) {
      const onDisk = readdirSync(`${LOCALES_DIR}/${language}`)
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length))
        .sort()

      // A namespace file nobody registered is a file nobody loads, and a registered namespace with
      // no file renders its keys at a reader.
      expect(onDisk, `for ${language}`).toEqual([...NAMESPACES].sort())
    }
  })
})
