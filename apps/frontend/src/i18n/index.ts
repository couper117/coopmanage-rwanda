import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import type { Locale } from '@coopmanage/shared'
import { LANGUAGE_TO_LOCALE, LOCALE_TO_LANGUAGE } from '@coopmanage/shared'

import enCommon from './locales/en/common.json'
import enDashboard from './locales/en/dashboard.json'
import enErrors from './locales/en/errors.json'
import enModules from './locales/en/modules.json'
import enNav from './locales/en/nav.json'
import enValidation from './locales/en/validation.json'
import rwCommon from './locales/rw/common.json'
import rwDashboard from './locales/rw/dashboard.json'
import rwErrors from './locales/rw/errors.json'
import rwModules from './locales/rw/modules.json'
import rwNav from './locales/rw/nav.json'
import rwValidation from './locales/rw/validation.json'

export const SUPPORTED_LANGUAGES = ['en', 'rw'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_STORAGE_KEY = 'coopmanage.language'

/**
 * Resources are split by feature namespace so a screen only depends on its own strings and the
 * shared ones. Both languages ship together from Phase 1; a key present in one and missing from
 * the other fails the parity test.
 */
export const resources = {
  en: {
    common: enCommon,
    nav: enNav,
    dashboard: enDashboard,
    errors: enErrors,
    validation: enValidation,
    modules: enModules,
  },
  rw: {
    common: rwCommon,
    nav: rwNav,
    dashboard: rwDashboard,
    errors: rwErrors,
    validation: rwValidation,
    modules: rwModules,
  },
} as const

export const NAMESPACES = Object.keys(resources.en) as (keyof typeof resources.en)[]

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    defaultNS: 'common',
    ns: NAMESPACES,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      // React escapes for us; double-escaping would show entities in the interface.
      escapeValue: false,
    },
    returnNull: false,
  })
  .then(() => {
    // init resolves synchronously with bundled resources, so the languageChanged listener below
    // never fires for the initial language. Setting it here is what makes a screen reader use the
    // right voice on first load for a user whose stored preference is Kinyarwanda.
    if (typeof document !== 'undefined') {
      document.documentElement.lang = i18n.resolvedLanguage ?? 'en'
    }
  })
  .catch((error: unknown) => {
    // Without resources every label would render as its key, so this must not pass unnoticed.
    console.error('Failed to initialise translations', error)
  })

/** Keeps the document language attribute in step, which screen readers rely on. */
i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language
})

export function currentLanguage(): Language {
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(language)
    ? (language as Language)
    : 'en'
}

export function currentLocale(): Locale {
  return LANGUAGE_TO_LOCALE[currentLanguage()]
}

export async function changeLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language)
}

export async function applyLocale(locale: Locale): Promise<void> {
  await changeLanguage(LOCALE_TO_LANGUAGE[locale])
}

export default i18n
