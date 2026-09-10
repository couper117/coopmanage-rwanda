import { describe, expect, it } from 'vitest'
import { NAMESPACES, resources, SUPPORTED_LANGUAGES } from '../src/i18n'

type Json = Record<string, unknown>

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
  const bundle = (resources[language] as Record<string, Json>)[namespace]
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
        const bundle = (resources[language] as Record<string, Json>)[namespace] ?? {}
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
      const en = (resources.en as Record<string, Json>)[namespace] ?? {}
      const rw = (resources.rw as Record<string, Json>)[namespace] ?? {}
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
      const en = (resources.en as Record<string, Json>)[namespace] ?? {}
      const rw = (resources.rw as Record<string, Json>)[namespace] ?? {}
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
