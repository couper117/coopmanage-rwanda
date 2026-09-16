import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Everything that must be true of the two translation bundles.
 *
 * Kinyarwanda is a first-class language in this product, not a layer added afterwards, and this is
 * the mechanism that keeps it that way: a key added in English without a Kinyarwanda counterpart, a
 * placeholder renamed in one language only, or a string left as a copy of the English fails the
 * build.
 *
 * One implementation, two entry points. The frontend test suite imports `runChecks` so a developer
 * sees a failure in the same run as everything else, and `npm run check:translations` runs it alone
 * for the named CI step. Duplicating the rules in a test and a script is how the two drift apart.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
export const LOCALES_DIR = resolve(HERE, '../../apps/frontend/src/i18n/locales')

export const LANGUAGES = ['en', 'rw']

/**
 * Strings that are intentionally the same in both languages: product names, codes, and words
 * Rwandan office staff use in English. Everything else must genuinely differ.
 */
const ALLOWED_IDENTICAL = new Set([
  'appName',
  'currency.code',
  'language.en',
  'language.rw',
  'unexpected.reference',
])

/**
 * Terms that must never appear in a Kinyarwanda string, and what to use instead.
 *
 * Each one is a mistake that was actually made, or one the glossary singles out as easy to make.
 * `docs/glossary.md` §8 carries the reasoning for all of them.
 */
const BANNED = [
  {
    pattern: /umukoresha/i,
    says: '"umukoresha" means employer; the person using the system is "ukoresha"',
  },
  {
    pattern: /shyingur/i,
    says: '"gushyingura" is to bury; archiving is "kubika mu bubiko"',
  },
  {
    pattern: /\bku?siba\b|\busibe\b/i,
    says: '"gusiba" is to erase, and nothing in this product is erased; filters are "gukuraho"',
  },
]

/** Curly quotation marks. Kinyarwanda elision is U+0027 and nothing else. */
const SMART_PUNCTUATION = /[‘’“”]/

/**
 * Kinyarwanda lives outside the locale files too, and the apostrophe rule follows it there.
 *
 * The shared report labels are printed on paper by the server, and the seeded names — permissions,
 * roles, units, finance categories, the demonstration cooperative's own products — become rows in a
 * cooperative's database. A curly apostrophe in any of them is a word spelled differently from the
 * same word on screen, which no search or sort will reconcile.
 *
 * Listed by name rather than found by a glob, so adding a file that carries Kinyarwanda is a
 * deliberate act that puts it under this rule.
 */
const KINYARWANDA_SOURCES = [
  'packages/shared/src/reports.ts',
  'apps/backend/src/modules/finance/finance.categories.ts',
  'apps/backend/src/modules/reports/render.pdf.ts',
  'apps/backend/src/modules/reports/render.csv.ts',
  'apps/backend/prisma/seed.ts',
  'apps/backend/prisma/seed-data/permissions.ts',
  'apps/backend/prisma/seed-data/roles.ts',
  'apps/backend/prisma/seed-data/units.ts',
  'apps/backend/prisma/seed-data/cooperative-types.ts',
  'apps/backend/prisma/seed-data/demo-cooperative.ts',
  'apps/backend/prisma/seed-data/demo-inventory.ts',
  'apps/backend/prisma/seed-data/demo-members.ts',
  'apps/backend/prisma/seed-data/demo-finance.ts',
  'apps/backend/prisma/seed-data/demo-sales.ts',
]

const PLACEHOLDER = /\{\{(\w+)\}\}/g

function readNamespaces(language) {
  const dir = join(LOCALES_DIR, language)
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort()
}

function readBundle(language, namespace) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, language, `${namespace}.json`), 'utf8'))
}

/** Flattens a nested bundle into dotted key paths with their string values. */
function flatten(input, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path))
    } else {
      out[path] = value
    }
  }
  return out
}

function placeholders(text) {
  return [...String(text).matchAll(PLACEHOLDER)].map((match) => match[1]).sort()
}

/**
 * Runs every check and returns the failures as readable lines. An empty array means the bundles
 * are sound.
 */
export function runChecks() {
  const failures = []
  const fail = (line) => failures.push(line)

  const namespaces = Object.fromEntries(LANGUAGES.map((lang) => [lang, readNamespaces(lang)]))
  if (namespaces.en.join(',') !== namespaces.rw.join(',')) {
    const missingRw = namespaces.en.filter((ns) => !namespaces.rw.includes(ns))
    const missingEn = namespaces.rw.filter((ns) => !namespaces.en.includes(ns))
    if (missingRw.length > 0) fail(`namespaces with no Kinyarwanda file: ${missingRw.join(', ')}`)
    if (missingEn.length > 0) fail(`namespaces with no English file: ${missingEn.join(', ')}`)
    return failures
  }

  for (const namespace of namespaces.en) {
    const en = flatten(readBundle('en', namespace))
    const rw = flatten(readBundle('rw', namespace))

    for (const key of Object.keys(en)) {
      if (!(key in rw)) fail(`${namespace}.${key} has no Kinyarwanda`)
    }
    for (const key of Object.keys(rw)) {
      if (!(key in en)) fail(`${namespace}.${key} has no English`)
    }

    for (const language of LANGUAGES) {
      const bundle = language === 'en' ? en : rw
      for (const [key, value] of Object.entries(bundle)) {
        if (typeof value !== 'string') {
          fail(`${language}:${namespace}.${key} is not a string`)
          continue
        }
        if (value.trim().length === 0) fail(`${language}:${namespace}.${key} is empty`)
        if (SMART_PUNCTUATION.test(value)) {
          fail(
            `${language}:${namespace}.${key} uses a curly quotation mark; ` +
              `Kinyarwanda elision is the straight apostrophe U+0027`,
          )
        }
      }
    }

    for (const [key, value] of Object.entries(en)) {
      const other = rw[key]
      if (typeof value !== 'string' || typeof other !== 'string') continue

      if (placeholders(value).join(',') !== placeholders(other).join(',')) {
        fail(
          `${namespace}.${key} interpolates ${JSON.stringify(placeholders(value))} in English and ` +
            `${JSON.stringify(placeholders(other))} in Kinyarwanda`,
        )
      }

      if (value === other && !ALLOWED_IDENTICAL.has(key)) {
        fail(`${namespace}.${key} is the same text in both languages`)
      }

      /**
       * A string that interpolates `count` is pluralised by i18next, which needs a `_one` form to
       * select. Without one, English says "1 products are out of stock" — the defect this check
       * exists to stop coming back.
       */
      if (placeholders(value).includes('count')) {
        const singular = `${key}_one`
        for (const language of LANGUAGES) {
          const bundle = language === 'en' ? en : rw
          if (!(singular in bundle)) {
            fail(
              `${language}:${namespace}.${key} interpolates {{count}} but has no ` +
                `"${key}_one" beside it, so one of anything reads as a plural`,
            )
          }
        }
      }
    }

    for (const [key, value] of Object.entries(rw)) {
      if (typeof value !== 'string') continue
      for (const { pattern, says } of BANNED) {
        if (pattern.test(value)) fail(`rw:${namespace}.${key} — ${says}`)
      }
    }
  }

  for (const relative of KINYARWANDA_SOURCES) {
    const source = readFileSync(resolve(HERE, '../..', relative), 'utf8')
    const lines = source.split('\n')
    lines.forEach((line, index) => {
      if (SMART_PUNCTUATION.test(line)) {
        fail(
          `${relative}:${index + 1} uses a curly quotation mark; ` +
            `Kinyarwanda elision is the straight apostrophe U+0027`,
        )
      }
    })
  }

  return failures
}

// Run as a script: print what is wrong and exit non-zero, or say nothing is.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const failures = runChecks()
  if (failures.length === 0) {
    const count = readNamespaces('en').length
    console.log(`Translations sound: ${count} namespaces, English and Kinyarwanda in step.`)
    process.exit(0)
  }
  console.error(`${failures.length} translation problem(s):\n`)
  for (const line of failures) console.error(`  ${line}`)
  process.exit(1)
}
