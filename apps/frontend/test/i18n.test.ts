import { describe, expect, it } from 'vitest'
import { NAMESPACES, SUPPORTED_LANGUAGES } from '../src/i18n'

type Json = Record<string, unknown>

/**
 * Every translation file, read straight off disk.
 *
 * Not through `resources` from `src/i18n`: that object deliberately holds only the namespaces the
 * shell needs before anything renders, because the rest are fetched when the screen that needs
 * them is opened. A test that imported the whole set from the application would put the whole set
 * back into the application's first download — the exact thing the split was for.
 *
 * `import.meta.glob` with `eager` is Vite's way of reading a directory at build time, so the files
 * are still checked at their real paths and a namespace added without a Kinyarwanda counterpart
 * still fails here.
 */
const files = import.meta.glob<{ default: Json }>('../src/i18n/locales/*/*.json', { eager: true })

const resources: Record<'en' | 'rw', Record<string, Json>> = { en: {}, rw: {} }
for (const [path, module] of Object.entries(files)) {
  const match = /locales\/(en|rw)\/([a-z]+)\.json$/.exec(path)
  const language = match?.[1]
  const namespace = match?.[2]
  if (!language || !namespace) continue
  resources[language as 'en' | 'rw'][namespace] = module.default
}

/** Flattens a nested resource object into dotted key paths. */
function flatten(input: Json, prefix = ''): string[] {
  return Object.entries(input).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return flatten(value as Json, path)
    }
    return [path]
  })
}

function keysFor(language: 'en' | 'rw', namespace: string): string[] {
  const bundle = resources[language][namespace]
  return flatten(bundle ?? {}).sort()
}

/**
 * Kinyarwanda is a first-class language, not a translation layer added later. This suite is the
 * mechanism that keeps it that way: a key added in English without a Kinyarwanda counterpart, or
 * left as a copy of the English text, fails the build.
 */
describe('translation parity', () => {
  it('ships the same namespaces in both languages', () => {
    expect(Object.keys(resources.en).sort()).toEqual(Object.keys(resources.rw).sort())
  })

  for (const namespace of NAMESPACES) {
    it(`has identical keys in both languages for "${namespace}"`, () => {
      const en = keysFor('en', namespace)
      const rw = keysFor('rw', namespace)

      const missingInRw = en.filter((key) => !rw.includes(key))
      const missingInEn = rw.filter((key) => !en.includes(key))

      expect(missingInRw, `missing Kinyarwanda keys: ${missingInRw.join(', ')}`).toEqual([])
      expect(missingInEn, `missing English keys: ${missingInEn.join(', ')}`).toEqual([])
    })
  }

  it('has no empty string in any language', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      for (const namespace of NAMESPACES) {
        const bundle = resources[language][namespace] ?? {}
        for (const key of flatten(bundle)) {
          const value = key
            .split('.')
            .reduce<unknown>((node, part) => (node as Json)?.[part], bundle)
          expect(
            String(value).trim().length,
            `${language}:${namespace}.${key} is empty`,
          ).toBeGreaterThan(0)
        }
      }
    }
  })

  it('keeps interpolation placeholders identical across languages', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] as string).sort()

    for (const namespace of NAMESPACES) {
      const en = resources.en[namespace] ?? {}
      const rw = resources.rw[namespace] ?? {}
      for (const key of flatten(en)) {
        const read = (bundle: Json): string =>
          String(key.split('.').reduce<unknown>((node, part) => (node as Json)?.[part], bundle))
        expect(placeholders(read(rw)), `${namespace}.${key} placeholders differ`).toEqual(
          placeholders(read(en)),
        )
      }
    }
  })

  it('does not leave a translatable string untranslated', () => {
    // A handful of strings are intentionally the same in both languages: product names, codes and
    // words Rwandan office staff use in English. Everything else must genuinely differ.
    const allowedIdentical = new Set([
      'appName',
      'currency.code',
      'language.en',
      'language.rw',
      'unexpected.reference',
    ])

    for (const namespace of NAMESPACES) {
      const en = resources.en[namespace] ?? {}
      const rw = resources.rw[namespace] ?? {}
      const identical: string[] = []
      for (const key of flatten(en)) {
        if (allowedIdentical.has(key)) continue
        const read = (bundle: Json): string =>
          String(key.split('.').reduce<unknown>((node, part) => (node as Json)?.[part], bundle))
        if (read(en) === read(rw)) identical.push(`${namespace}.${key}`)
      }
      expect(identical, `untranslated: ${identical.join(', ')}`).toEqual([])
    }
  })
})
